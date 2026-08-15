import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance, WORK_TIME_MONEY_TYPES, type WorkTimeMoneyType } from "@/lib/work-time";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";

// Правка суммы отдельного (не привязанного к смене) аванса/премии —
// docs/spec/05-work-time.md, "АВАНС"/"ПРЕМИЯ": "владелец может редактировать".
// Журнал правок как в Счётчиках: было → стало.
export async function PATCH(request: Request, ctx: RouteContext<"/api/work-time/money-ops/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  // bonus_accrual (режим "Только начисление", 2026-08-12) — тот же вид записи,
  // что bonus_payout, просто деньги не выданы, а записаны в долг. Карточка
  // сотрудника рисовала ему карандаш наравне с остальными, а этот роут
  // отвечал "Операция не найдена" — кнопка была, действия не было (2026-08-14).
  // Проверки овердрафта ему не нужны: из кассы точки ничего не уходит
  // (affectsCashOnHand исключает этот тип), разносить по зонам нечего.
  if (!op || op.tenantId !== owner.tenantId || !WORK_TIME_MONEY_TYPES.includes(op.type as WorkTimeMoneyType)) {
    return NextResponse.json({ error: "Операция не найдена" }, { status: 404 });
  }

  const { amount, reason } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const before = Math.abs(Number(op.amount));

  if (op.type === "advance" && amountNumber > before && op.beneficiaryOperatorId) {
    // Отдельный (не привязанный к смене) аванс/премия — всегда вносится
    // владельцем вручную (docs/spec/05-work-time.md), не забор из кассы
    // точки (решение пользователя 2026-07-15) — проверка по личному балансу
    // "к выдаче" + овердрафт, как и при создании.
    const beneficiary = await prisma.operator.findUnique({
      where: { id: op.beneficiaryOperatorId },
      select: { overdraftAllowed: true },
    });
    const balance = await calcOperatorBalance(op.beneficiaryOperatorId);
    const availableExcludingThis = balance.toPayOut + before;
    if (!beneficiary?.overdraftAllowed && amountNumber > availableExcludingThis) {
      const locale = await resolveLocale();
      return NextResponse.json(
        { error: `Аванс превышает доступный баланс к выдаче (${formatMoney(availableExcludingThis, locale)})` },
        { status: 400 }
      );
    }
  }

  if (before !== amountNumber) {
    await prisma.$transaction([
      prisma.moneyOperation.update({ where: { id }, data: { amount: -amountNumber } }),
      prisma.correctionLog.create({
        data: {
          entityType: "MoneyOperation",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: { amount: before },
          afterJson: { amount: amountNumber },
          comment: typeof reason === "string" && reason.trim() ? reason.trim() : null,
        },
      }),
    ]);
    // Сводка смены и "Касса за день" содержат эту сумму — догоняем их
    // (требование владельца 2026-08-16, lib/summary-channels/resync.ts).
    await resyncAfterMoneyOpChange(op);
  }

  return NextResponse.json({
    balance: op.beneficiaryOperatorId ? await calcOperatorBalance(op.beneficiaryOperatorId) : null,
  });
}

// Удаление отдельного (не привязанного к смене) аванса/премии — владелец
// вводит их вручную из карточки, значит должен уметь и убрать ошибочную
// запись целиком, не только поправить сумму.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/work-time/money-ops/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  // bonus_accrual (режим "Только начисление", 2026-08-12) — тот же вид записи,
  // что bonus_payout, просто деньги не выданы, а записаны в долг. Карточка
  // сотрудника рисовала ему карандаш наравне с остальными, а этот роут
  // отвечал "Операция не найдена" — кнопка была, действия не было (2026-08-14).
  // Проверки овердрафта ему не нужны: из кассы точки ничего не уходит
  // (affectsCashOnHand исключает этот тип), разносить по зонам нечего.
  if (!op || op.tenantId !== owner.tenantId || !WORK_TIME_MONEY_TYPES.includes(op.type as WorkTimeMoneyType)) {
    return NextResponse.json({ error: "Операция не найдена" }, { status: 404 });
  }

  const before = { type: op.type, amount: Math.abs(Number(op.amount)) };
  const beneficiaryOperatorId = op.beneficiaryOperatorId;

  await prisma.$transaction([
    prisma.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: { deleted: true },
        comment: null,
      },
    }),
    prisma.moneyOperation.delete({ where: { id } }),
  ]);

  await resyncAfterMoneyOpChange(op);

  return NextResponse.json({
    balance: beneficiaryOperatorId ? await calcOperatorBalance(beneficiaryOperatorId) : null,
  });
}
