import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getTenantDayContext } from "@/lib/tenant-day";
import { getBusinessDayBounds } from "@/lib/business-day";
import { dispatchExpenseAlert } from "@/lib/summary-channels/dispatch";
import { EXPENSE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";

/**
 * Расходы, зафиксированные Сотрудником в моменте (запрос пользователя
 * 2026-07-25: "чтобы не надо было запоминать до конца смены") — доступны для
 * ЛЮБОЙ зоны точки, не только режима "Счётчики" (расход не завязан на режим
 * учёта — экран "Расходы" не в баре "Счётчики", виден всем сотрудникам).
 *
 * С 2026-08-15 расход — это сразу MoneyOperation type="expense", отдельного
 * журнала-черновика больше нет: деньги вынуты из кассы в момент ввода, тогда
 * же он и виден владельцу. "Текущий период" зоны (что показывает этот экран и
 * что ещё можно удалить) — операции с resultsSubmissionId = null: сдача
 * итогов проставляет им свою ссылку, и они уходят с экрана ровно так же, как
 * раньше "обнулялись" следующей сдачей.
 */
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  // Настройки → Система → "Расходы" (запрос пользователя 2026-07-25) —
  // серверная проверка, не только скрытие кнопки/экрана в UI (тот же
  // принцип, что у goodsAllowBalancePayment/Operator.goodsAccess).
  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { expensesEnabled: true } });
  if (tenant?.expensesEnabled === false) {
    return NextResponse.json({ error: "Расходы отключены владельцем" }, { status: 403 });
  }

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  const [zones, categories, day] = await Promise.all([
    prisma.zone.findMany({
      where: zoneWhere,
      select: { id: true, name: true, iconKey: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expenseCategory.findMany({
      where: { tenantId: point.tenantId },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    getTenantDayContext(point.tenantId),
  ]);
  if (zones.length === 0) {
    return NextResponse.json({ zones: [], categories, events: [] });
  }

  const zoneIds = zones.map((z) => z.id);
  // "Итоги по зоне уже сданы сегодня" — только подсказка Сотруднику в форме
  // (расход всё равно запишется и всё равно будет виден владельцу, см. шапку
  // файла): деньги удобнее вносить ДО сдачи, чтобы сумма попала в ту же
  // сверку кассы, а не осталась висеть до следующей. Бизнес-день, а не
  // календарный: у точек, закрывающихся после полуночи, сдача в 01:00 — это
  // всё ещё вчерашний рабочий день.
  const bounds = getBusinessDayBounds(day.boundary, new Date(), day.timezone);
  const [rawEvents, submittedZones] = await Promise.all([
    prisma.moneyOperation.findMany({
      where: { type: "expense", zoneId: { in: zoneIds }, resultsSubmissionId: null },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: { expenseCategory: { select: { name: true } } },
    }),
    prisma.zoneSubmission.findMany({
      where: { zoneId: { in: zoneIds }, createdAt: { gte: bounds.start, lt: bounds.end } },
      select: { zoneId: true },
      distinct: ["zoneId"],
    }),
  ]);

  const submittedZoneIds = new Set(submittedZones.map((z) => z.zoneId));
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  return NextResponse.json({
    zones: zones.map((z) => ({ ...z, submittedToday: submittedZoneIds.has(z.id) })),
    categories,
    events: rawEvents.map((e) => ({
      id: e.id,
      zoneId: e.zoneId!,
      zoneName: zoneById.get(e.zoneId!)?.name ?? "",
      // Операция хранится отрицательной (расход), экран показывает модуль —
      // как и весь остальной UI расходов.
      amount: Math.abs(Number(e.amount)),
      categoryName: e.expenseCategory?.name ?? null,
      comment: e.comment,
      createdAt: e.occurredAt,
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { expensesEnabled: true } });
  if (tenant?.expensesEnabled === false) {
    return NextResponse.json({ error: "Расходы отключены владельцем" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const zoneId = body?.zoneId;
  const amount = Number(body?.amount);
  const categoryId: string | null = typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;
  const comment: string | null = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;

  if (typeof zoneId !== "string" || !zoneId) {
    return NextResponse.json({ error: "Не указана зона" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const zone = await prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId: point.id,
      active: true,
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: { id: true, name: true },
  });
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  // Имя категории нужно и для проверки принадлежности тенанту, и для строки
  // "Категория · Зона" в уведомлении владельцу — один запрос на оба.
  let category: { id: string; name: string } | null = null;
  if (categoryId) {
    const found = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!found || found.tenantId !== point.tenantId) {
      return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    }
    category = { id: found.id, name: found.name };
  }

  // Отрицательная сумма и zoneId без pointId — как у расходов, которые
  // раньше создавала сдача итогов (CHECK-констрейнт требует ровно одно из
  // zoneId/pointId). resultsSubmissionId пока null: сдача проставит его сама.
  const operation = await prisma.moneyOperation.create({
    data: {
      tenantId: point.tenantId,
      zoneId: zone.id,
      type: "expense",
      amount: -Math.abs(amount),
      performedByOperatorId: operator.id,
      expenseCategoryId: categoryId,
      comment,
    },
  });

  // Уведомление владельцу "Новый расход" (запрос владельца 2026-08-15) — не
  // ждём отправки и не роняем запись расхода, если канал недоступен, тот же
  // fire-and-forget, что у остальных dispatch-вызовов. Тумблер Telegram/email
  // здесь, тумблер Push — внутри dispatchExpenseAlert.
  const alertSettings = await prisma.expenseSummarySettings.findUnique({ where: { tenantId: point.tenantId } });
  if (alertSettings?.enabled ?? EXPENSE_SUMMARY_DEFAULTS.enabled) {
    dispatchExpenseAlert(point.tenantId, {
      occurredAt: operation.occurredAt,
      operatorName: operator.name,
      operatorColorTag: operator.colorTag ?? null,
      amount: Math.abs(Number(operation.amount)),
      categoryName: category?.name ?? null,
      zoneName: zone.name,
    })
      .then(async (results) => {
        // id сообщения — чтобы правка расхода владельцем переписала его на
        // месте (api/money/expenses/[id]). Пишем после ответа Telegram,
        // отдельным update: сам расход к этому моменту уже сохранён и от
        // судьбы уведомления не зависит.
        const messageId = results.find((r) => r.channelType === "telegram" && r.externalMessageId)?.externalMessageId;
        if (messageId) {
          await prisma.moneyOperation
            .update({ where: { id: operation.id }, data: { expenseAlertMessageId: messageId } })
            .catch(() => {});
        }
      })
      .catch((err) => console.error("expense alert dispatch failed", err));
  }

  return NextResponse.json({
    id: operation.id,
    zoneId: operation.zoneId,
    amount: Math.abs(Number(operation.amount)),
    createdAt: operation.occurredAt,
  });
}
