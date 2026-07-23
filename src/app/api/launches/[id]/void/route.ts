import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { notifyWalletBalanceChange } from "@/lib/abonement";

/**
 * Аннулирование пуска (docs/spec/04-game-room.md, "Жизненный цикл") — только
 * владелец, любой пуск ("Пуски"/"Прибывания"), открытый или уже завершённый.
 * Открытый пуск закрывается тем же действием (isOpen:false, endedAt=now,
 * если ещё не было) — иначе навсегда занимал бы номер браслета своего
 * актива (nextLaunchNumber в lib/game-room.ts смотрит на isOpen).
 *
 * Наличные/безнал НЕ реверсируются отдельной MoneyOperation — в отличие от
 * билетов, выручка "Прибываний"/"Пусков" наличными/безналом книгуется ОДНОЙ
 * суммой на всю зону при Сдаче итогов (реально пересчитанные оператором
 * деньги, docs/spec/04-game-room.md), а не поштучно на пуск — вычесть один
 * пуск из уже сданной пачки нечем, не исказив реальный физический пересчёт.
 * Пока пуск ЕЩЁ НЕ попал в сдачу (zoneSubmissionId===null), voidedAt уже
 * достаточно — aggregateGameRoomLaunches (lib/game-room.ts) фильтрует
 * voidedAt:null и просто перестанет считать его в расчётной выручке
 * следующего окна.
 *
 * Баланс (paymentMethod="abonement") — исключение, как и у билетов: реальное
 * списание уже произошло НЕЗАВИСИМО от Сдачи итогов (spendWalletTx в
 * lib/abonement.ts пишет revenue_abonement сразу при оплате), поэтому
 * возврат на кошелёк обязателен ВСЕГДА, вне зависимости от zoneSubmissionId.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/launches/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const launch = await prisma.launch.findUnique({
    where: { id },
    include: { zone: { include: { point: true } } },
  });
  if (!launch || launch.zone.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Пуск не найден" }, { status: 404 });
  }
  if (launch.voidedAt) {
    return NextResponse.json({ error: "Пуск уже аннулирован" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const reason: string | null = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  const before = { ...launch };
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      // CAS — двойной клик "Аннулировать" не должен дважды вернуть деньги
      // на баланс (тот же приём, что voidTicketInTx/voidGoodsSale).
      const voidResult = await tx.launch.updateMany({
        where: { id, voidedAt: null },
        data: {
          voidedAt: now,
          ...(launch.isOpen ? { isOpen: false, endedAt: launch.endedAt ?? now } : {}),
        },
      });
      if (voidResult.count === 0) throw new Error("ALREADY_VOIDED");

      let refundedWalletId: string | null = null;
      let refundedAmount = 0;
      if (launch.paymentMethod === "abonement" && launch.abonementWalletId && launch.amount != null) {
        refundedAmount = Number(launch.amount);
        refundedWalletId = launch.abonementWalletId;
        await tx.abonementWallet.update({
          where: { id: launch.abonementWalletId },
          data: { balance: { increment: refundedAmount } },
        });
        await tx.abonementTransaction.create({
          data: {
            walletId: launch.abonementWalletId,
            type: "refund",
            amount: refundedAmount,
            launchId: launch.id,
            pointId: launch.zone.pointId,
            userId: owner.user.id,
          },
        });
        await tx.moneyOperation.create({
          data: {
            tenantId: owner.tenantId,
            zoneId: launch.zoneId,
            type: "revenue_abonement",
            amount: -refundedAmount,
            performedByUserId: owner.user.id,
          },
        });
      }

      const updated = await tx.launch.findUniqueOrThrow({ where: { id } });

      await tx.correctionLog.create({
        data: {
          entityType: "Launch",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: JSON.parse(JSON.stringify(before)),
          afterJson: JSON.parse(JSON.stringify(updated)),
          comment: reason,
        },
      });

      return { updated, refundedWalletId, refundedAmount };
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_VOIDED") {
      return NextResponse.json({ error: "Пуск уже аннулирован" }, { status: 409 });
    }
    throw err;
  }

  if (result.refundedWalletId) {
    await notifyWalletBalanceChange(owner.tenantId, result.refundedWalletId, result.refundedAmount).catch(() => {});
  }

  return NextResponse.json({ id: result.updated.id, voidedAt: result.updated.voidedAt });
}
