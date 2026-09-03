import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance, WORK_TIME_MONEY_TYPES, type WorkTimeMoneyType } from "@/lib/work-time";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";
import { chargeSelfServiceAdvanceToZones } from "@/lib/zone-balance";

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
    await prisma.$transaction(async (tx) => {
      if (op.pointId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.pointId}))`;
      // Сумма ДО правки читается здесь, под локом, а не снаружи транзакции:
      // `before` снят до неё, и повторный запрос с тем же телом (двойной клик,
      // две вкладки) посчитал бы дельту от устаревшего значения и дорисовал
      // разницу зонам второй раз.
      const freshBefore = Math.abs(
        Number((await tx.moneyOperation.findUniqueOrThrow({ where: { id }, select: { amount: true } })).amount)
      );
      await tx.moneyOperation.update({ where: { id }, data: { amount: -amountNumber } });
      await tx.correctionLog.create({
        data: {
          entityType: "MoneyOperation",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: { amount: before },
          afterJson: { amount: amountNumber },
          comment: typeof reason === "string" && reason.trim() ? reason.trim() : null,
        },
      });
      // Дельту надо разнести по зонам (перепроверка 2026-09-03). Смена-версия
      // этой правки так и делает (work-time/shifts/[id]), а отдельная — нет, и
      // деньги зависали в журнале зон навсегда: аванс 300 разнесён как −300,
      // правка на 100 уменьшила кассу точки на 100, а зоны так и остались с
      // −300. Дефицит при этом уже нулевой — отсечку сдвинули сами
      // advance_settlement, — и добрать разницу было нечем.
      //
      // Только для тех типов, что реально уходят из кассы: bonus_accrual в
      // ней не участвует вовсе (CASH_EXCLUDED_TYPES).
      //
      // И ТОЛЬКО если деньги действительно уходили из кассы точки: признак —
      // performedByOperatorId, «из чьих рук ушли». У записей, созданных до
      // 2026-09-02, его нет: тогда действовало обратное правило, и по зонам
      // они не разносились. Разнести их отмену значило бы вернуть зонам
      // деньги, которых там никогда не списывали (закрывающий аудит).
      if (op.pointId && op.beneficiaryOperatorId && op.performedByOperatorId && op.type !== "bonus_accrual") {
        const delta = Math.round((amountNumber - freshBefore) * 100) / 100;
        if (delta !== 0) {
          await chargeSelfServiceAdvanceToZones(
            owner.tenantId,
            op.pointId,
            delta,
            op.beneficiaryOperatorId,
            tx
          );
        }
      }
    });
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

  await prisma.$transaction(async (tx) => {
    if (op.pointId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.pointId}))`;
    await tx.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: { deleted: true },
        comment: null,
      },
    });
    await tx.moneyOperation.delete({ where: { id } });
    // Возвращаем зонам то, что было на них разнесено (перепроверка
    // 2026-09-03) — иначе после удаления аванса касса точки растёт, а зоны
    // остаются списанными навсегда. Отрицательная сумма разворачивает
    // разнесение, ровно как это делает удаление смены.
    // Только если деньги уходили из кассы — см. комментарий в PATCH выше.
    if (op.pointId && beneficiaryOperatorId && op.performedByOperatorId && op.type !== "bonus_accrual") {
      await chargeSelfServiceAdvanceToZones(owner.tenantId, op.pointId, -before.amount, beneficiaryOperatorId, tx);
    }
  });

  await resyncAfterMoneyOpChange(op);

  return NextResponse.json({
    balance: beneficiaryOperatorId ? await calcOperatorBalance(beneficiaryOperatorId) : null,
  });
}
