import { NextResponse } from "next/server";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";

// Ручная премия из карточки оператора (docs/spec/05-work-time.md) — не
// привязана к смене, комментарий не требуется. Овердрафт не проверяется:
// премия не входит в "к выдаче" (уже выдана), только в "заработано".
//
// Деньги ИЗ КАРМАНА ВЛАДЕЛЬЦА, кассы точки не касаются — разбор правила и
// история его метаний в /advance/route.ts рядом. Коротко: со 2 по 4 сентября
// здесь стояло обратное правило («из кассы точки»), поставленное по случаю
// КидсБурга, и 4 сентября оно увело в минус все зоны Керен Центра.
//
// Правило работает ТОЛЬКО ВПЕРЁД: у записей, созданных раньше, поля прежние,
// и остатки за прошлые дни не сдвигаются. Прошлое не переписываем.
export async function POST(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/bonus">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { amount, pointId } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

  // Advisory-лок по operatorId (аудит 2026-07-26) — тот же класс бага, что и
  // у /advance: форма на карточке оператора не была защищена от двойного
  // клика/тапа, каждый CREATE безусловный, без идемпотентности — выплата
  // премии реально задваивалась.
  // ПРЕМИЯ ОТ ВЛАДЕЛЬЦА — ИЗ ЕГО КАРМАНА, кассы точки не касается (правило
  // владельца 2026-09-04: «все авансы и премии, которые вносит владелец, это
  // из его кармана и к остаткам по зоне значения не имеет»). Разбор — в
  // комментарии у /advance/route.ts рядом.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
    await tx.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId: point.id,
        type: "bonus_payout",
        amount: -amountNumber,
        // Только performedByUserId: деньги не выходили из ящика, и
        // getPointCashBalance такую запись из остатка исключает. Получателя
        // держит beneficiaryOperatorId — личный баланс сотрудника считается
        // по нему, поэтому «к выдаче» уменьшается как и должно.
        performedByUserId: owner.user.id,
        beneficiaryOperatorId: operator.id,
      },
    });
  });

  // Пересборка уже отправленных сводок — та же причина и тот же приём, что у
  // аванса рядом (/advance/route.ts): роуты карточки не звали resync вообще.
  await resyncAfterMoneyOpChange({
    tenantId: owner.tenantId,
    zoneId: null,
    pointId: point.id,
    shiftId: null,
    occurredAt: new Date(),
  }).catch(() => {});

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
