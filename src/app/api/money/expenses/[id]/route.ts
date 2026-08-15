import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { editChatMessage } from "@/lib/telegram-bot";
import { getDictionary } from "@/lib/i18n";
import { isLocale, type Locale } from "@/lib/locales";
import { formatExpenseAlertTelegram } from "@/lib/summary-channels/telegram-format";

/**
 * Правка/удаление расхода владельцем прямо в реестре (запрос пользователя
 * 2026-08-15). Сотрудник может исправить свою запись только до сдачи итогов
 * (api/operator/zone-expense-events/[id]) — после неё, а также по любому
 * чужому расходу, это может лишь Владелец. Журнал правок — тот же, что у
 * инкассаций и авансов/премий: было → стало, entityType "MoneyOperation".
 *
 * Правится сумма, категория, комментарий и зона (зона — по запросу владельца
 * 2026-08-15: сотрудник вполне может записать расход не туда). Время ввода не
 * правится — это момент события, а не выбор.
 */
async function loadExpense(id: string, tenantId: string) {
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  if (!op || op.tenantId !== tenantId || op.type !== "expense") return null;
  return op;
}

/**
 * Переписывает уже отправленное Telegram-сообщение "Новый расход" после
 * правки (запрос владельца 2026-08-15) — тот же приём и та же best-effort
 * логика, что у reEditZoneSummaryMessage: падение здесь не должно ронять
 * саму правку, она к этому моменту уже сохранена.
 */
async function reEditExpenseAlert(operationId: string, tenantId: string): Promise<void> {
  const op = await prisma.moneyOperation.findUnique({
    where: { id: operationId },
    include: {
      expenseCategory: { select: { name: true } },
      zone: { select: { name: true } },
      performedByOperator: { select: { name: true, colorTag: true } },
    },
  });
  if (!op?.expenseAlertMessageId) return;

  const [channel, tenant] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { locale: true, timezone: true, currency: true } }),
  ]);
  if (!channel?.chatId) return;

  const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  const text = formatExpenseAlertTelegram(
    {
      occurredAt: op.occurredAt,
      operatorName: op.performedByOperator?.name ?? "",
      operatorColorTag: op.performedByOperator?.colorTag ?? null,
      amount: Math.abs(Number(op.amount)),
      categoryName: op.expenseCategory?.name ?? null,
      zoneName: op.zone?.name ?? "",
    },
    getDictionary(locale).summaryText,
    locale,
    tenant?.timezone ?? "UTC",
    tenant?.currency ?? null
  );
  await editChatMessage(channel.chatId, op.expenseAlertMessageId, text);
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/money/expenses/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await loadExpense(id, owner.tenantId);
  if (!op) {
    return NextResponse.json({ error: "Расход не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const amountNumber = Math.abs(Number(body?.amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }
  const categoryId: string | null =
    typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;
  const comment: string | null =
    typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
  const zoneId: string = typeof body?.zoneId === "string" && body.zoneId ? body.zoneId : (op.zoneId ?? "");

  // Чужая категория — тот же класс проверки, что в роуте Сотрудника: без неё
  // подсунутый id упал бы FK-ошибкой уже внутри записи.
  if (categoryId) {
    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.tenantId !== owner.tenantId) {
      return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    }
  }
  if (zoneId !== op.zoneId) {
    const zone = await prisma.zone.findFirst({
      where: { id: zoneId, point: { tenantId: owner.tenantId } },
      select: { id: true },
    });
    if (!zone) {
      return NextResponse.json({ error: "Зона не найдена" }, { status: 400 });
    }
  }

  const before = {
    amount: Math.abs(Number(op.amount)),
    categoryId: op.expenseCategoryId,
    comment: op.comment,
    zoneId: op.zoneId,
  };
  const after = { amount: amountNumber, categoryId, comment, zoneId };
  const zoneChanged = before.zoneId !== after.zoneId;
  const unchanged =
    before.amount === after.amount &&
    before.categoryId === after.categoryId &&
    before.comment === after.comment &&
    !zoneChanged;
  if (unchanged) return NextResponse.json({ ok: true });

  await prisma.$transaction(async (tx) => {
    await tx.moneyOperation.update({
      where: { id },
      data: {
        amount: -amountNumber,
        expenseCategoryId: categoryId,
        comment,
        zoneId,
        // Смена зоны разрывает связь со сдачей: сдача закрывает расходы СВОЕЙ
        // зоны (её и ищут по паре resultsSubmissionId+zoneId — см. удаление
        // сдачи), и расход, уехавший в другую зону, к ней больше не относится.
        // Он возвращается в "текущий период" новой зоны и закроется её
        // ближайшей сдачей — деньги при этом уже учтены, меняется только то,
        // из какой кассы они списаны.
        ...(zoneChanged ? { resultsSubmissionId: null } : {}),
      },
    });
    await tx.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: after,
        comment: null,
      },
    });
  });

  // Уже отправленное уведомление приводим в соответствие с правкой (запрос
  // владельца 2026-08-15) — best-effort, как у сводки по зоне: правка
  // сохранена независимо от того, жив ли ещё чат и сообщение в нём.
  await reEditExpenseAlert(id, owner.tenantId).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/money/expenses/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await loadExpense(id, owner.tenantId);
  if (!op) {
    return NextResponse.json({ error: "Расход не найден" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: {
          amount: Math.abs(Number(op.amount)),
          categoryId: op.expenseCategoryId,
          comment: op.comment,
        },
        afterJson: { deleted: true },
        comment: null,
      },
    });
    await tx.moneyOperation.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
