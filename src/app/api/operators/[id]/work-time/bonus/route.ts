import { NextResponse } from "next/server";
import { chargeSelfServiceAdvanceToZones } from "@/lib/zone-balance";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";

// Ручная премия из карточки оператора (docs/spec/05-work-time.md) — не
// привязана к смене, комментарий не требуется. Овердрафт не проверяется:
// премия не входит в "к выдаче" (уже выдана), только в "заработано".
//
// Деньги ИЗ КАССЫ ТОЧКИ (решение владельца 2026-09-02, на живом примере).
// До этого стояло обратное правило от 2026-07-15 — «уже забраны инкассацией
// или переданы отдельно», — и запись несла только performedByUserId, из-за
// чего getPointCashBalance её не видел вовсе. В тот же день у КидсБурга
// владелец внёс из карточек 200 + 800 + 800 + 200, сотрудник вечером
// пересчитал ящик и прислал в чат остаток ровно на 2000 меньше того, что
// показывало приложение. Признак — beneficiaryOperatorId в
// performedByOperatorId: деньги ушли из кассы в руки этого сотрудника, ровно
// тот же смысл, что у аванса, который владелец дописывает в закрытую смену
// (правка 2026-08-31, syncLinkedOp в /api/work-time/shifts/[id]).
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
  await prisma.$transaction(async (tx) => {
    // Лок точки — деньги теперь уходят из её кассы и разносятся по зонам той
    // же транзакцией; без него инкассация в зазор списала бы их второй раз
    // (тот же класс, что закрыт в check-out и work-time/shifts).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${point.id}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
    await tx.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId: point.id,
        type: "bonus_payout",
        amount: -amountNumber,
        performedByUserId: owner.user.id,
        // Оба поля: кто внёс запись и из чьих рук ушли деньги.
        performedByOperatorId: operator.id,
        beneficiaryOperatorId: operator.id,
      },
    });
    // Сразу по зонам — иначе остаток точки упал бы, а журналы зон остались бы
    // прежними, и разницу пришлось бы добирать «пулом» на следующей
    // инкассации, задним числом и без понятной причины.
    await chargeSelfServiceAdvanceToZones(owner.tenantId, point.id, amountNumber, operator.id, tx);
  });

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
