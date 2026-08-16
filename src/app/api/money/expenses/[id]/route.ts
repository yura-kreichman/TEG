import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { editChatMessage } from "@/lib/telegram-bot";
import { getDictionary } from "@/lib/i18n";
import { isLocale, type Locale } from "@/lib/locales";
import { formatExpenseAlertTelegram } from "@/lib/summary-channels/telegram-format";
import { resyncAfterMoneyOpChange, sendUpdatedPush } from "@/lib/summary-channels/resync";

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
      zone: { select: { name: true, telegramEmoji: true } },
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
      zoneEmoji: op.zone?.telegramEmoji ?? null,
      comment: op.comment,
      // Сюда попадаем только из PATCH владельца — сообщение переписывается
      // именно потому, что он расход поправил.
      editedByOwner: true,
    },
    getDictionary(locale).summaryText,
    locale,
    tenant?.timezone ?? "UTC",
    tenant?.currency ?? null
  );
  await editChatMessage(channel.chatId, op.expenseAlertMessageId, text);
  // И свежий Push поверх исправленного сообщения (требование владельца
  // 2026-08-16) — отредактировать уже доставленное уведомление нельзя.
  await sendUpdatedPush(tenantId, "expense", getDictionary(locale).pushSettings.expenseLabel, text);
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
  const zoneChanged = zoneId !== op.zoneId;
  if (zoneChanged) {
    const zone = await prisma.zone.findFirst({
      where: { id: zoneId, point: { tenantId: owner.tenantId } },
      select: { id: true },
    });
    if (!zone) {
      return NextResponse.json({ error: "Зона не найдена" }, { status: 400 });
    }
  }

  // Куда расход попадёт после смены зоны (вопрос владельца 2026-08-15: "а
  // нельзя перенести расход в ту зону, куда перенесли в сдаче итогов").
  // Сдача итогов — общая на все зоны, сданные разом: если новая зона входит
  // в ТУ ЖЕ сдачу, расход остаётся закрытым ею, просто меняет кассу — и из
  // отчёта по этой сдаче никуда не пропадает. Если не входит (перенос в зону
  // другой точки или в зону, которую тогда не сдавали) — привязку снимаем, и
  // расход закроется ближайшей сдачей новой зоны.
  let nextResultsSubmissionId = op.resultsSubmissionId;
  if (zoneChanged && op.resultsSubmissionId) {
    const coveredBySameSubmission = await prisma.zoneSubmission.findFirst({
      where: { resultsSubmissionId: op.resultsSubmissionId, zoneId },
      select: { id: true },
    });
    nextResultsSubmissionId = coveredBySameSubmission ? op.resultsSubmissionId : null;
  }

  const before = {
    amount: Math.abs(Number(op.amount)),
    categoryId: op.expenseCategoryId,
    comment: op.comment,
    zoneId: op.zoneId,
    resultsSubmissionId: op.resultsSubmissionId,
  };
  const after = {
    amount: amountNumber,
    categoryId,
    comment,
    zoneId,
    resultsSubmissionId: nextResultsSubmissionId,
  };
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
        resultsSubmissionId: nextResultsSubmissionId,
      },
    });

    // Расход переехал в другую зону — вместе с ним переезжает и прибавка,
    // которую сдача внесла в выручку зоны (решение владельца 2026-08-16).
    // При сдаче в журнал пишется "получено наличными" = сданный остаток +
    // расходы ЭТОЙ зоны (api/operator/submit-results, cashReceived), поэтому
    // без переноса выручка старой зоны остаётся завышенной на сумму расхода,
    // а новой — заниженной: общая касса точки и Разница сходятся, а разрез по
    // зонам в Отчётах врёт.
    //
    // Переносим ИСТОРИЧЕСКУЮ сумму (какой расход был на момент сдачи), а не
    // новую: правка суммы намеренно оставляет выручку нетронутой и проявляется
    // как недостача/излишек в Разнице — тут меняется только адрес расхода.
    if (zoneChanged && op.resultsSubmissionId) {
      const moved = Math.abs(Number(op.amount));
      const previousRevenue = await tx.moneyOperation.findFirst({
        where: { type: "revenue", resultsSubmissionId: op.resultsSubmissionId, zoneId: op.zoneId },
        select: { id: true, amount: true },
      });
      if (previousRevenue) {
        const left = Math.round((Number(previousRevenue.amount) - moved) * 100) / 100;
        // Ноль остаётся, когда вся касса зоны ушла в этот расход — операцию
        // с нулевой суммой в журнале не держим.
        if (left > 0) {
          await tx.moneyOperation.update({ where: { id: previousRevenue.id }, data: { amount: left } });
        } else {
          await tx.moneyOperation.delete({ where: { id: previousRevenue.id } });
        }
      }
      // Принимающая сторона — только если расход остался в той же сдаче
      // (nextResultsSubmissionId её сохранил). Ушёл в зону другой точки или
      // другой сдачи — прибавлять некуда и не нужно: там деньги брали из
      // своей кассы, и её остаток честно уменьшается на этот расход.
      if (nextResultsSubmissionId) {
        const receivingRevenue = await tx.moneyOperation.findFirst({
          where: { type: "revenue", resultsSubmissionId: nextResultsSubmissionId, zoneId },
          select: { id: true, amount: true },
        });
        if (receivingRevenue) {
          await tx.moneyOperation.update({
            where: { id: receivingRevenue.id },
            data: { amount: Math.round((Number(receivingRevenue.amount) + moved) * 100) / 100 },
          });
        } else {
          // Зона сдала ноль наличными — операции выручки у неё нет вовсе
          // (сдача создаёт её только при cashReceived > 0). Заводим: эти
          // деньги в зоне получены и тут же потрачены.
          await tx.moneyOperation.create({
            data: {
              tenantId: owner.tenantId,
              zoneId,
              type: "revenue",
              amount: moved,
              occurredAt: op.occurredAt,
              resultsSubmissionId: nextResultsSubmissionId,
            },
          });
        }
      }
    }
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
  // Плюс общие сообщения, которые эту сумму суммируют, — "Касса за день"
  // (lib/summary-channels/resync.ts).
  await resyncAfterMoneyOpChange({ ...op, zoneId, occurredAt: op.occurredAt });

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

  await resyncAfterMoneyOpChange(op);

  return NextResponse.json({ ok: true });
}
