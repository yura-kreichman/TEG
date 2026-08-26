import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";
import { notifyWalletBalanceChange } from "@/lib/abonement";
import { PAYMENT_SPLIT_METHOD } from "@/lib/payment-split";

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

/**
 * Отменить случайный тап — та же логика, что у /api/operator/zone-return-
 * events/[id]: обычная отмена опечатки в моменте ("раз не внёс — проехали"
 * при сдаче итогов), не ретроактивная правка. Только события ТЕКУЩЕГО
 * периода зоны.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/operator/tap-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point, operator } = opCtx;
  const { id } = await ctx.params;

  const event = await prisma.counterTapEvent.findFirst({ where: { id, pointId: point.id } });
  if (!event) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(event.zoneId);
  if (boundary && event.createdAt <= boundary) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  // Реальный баг (аудит 2026-07-26) — тап, оплаченный балансом (целиком или
  // долей разбивки), при удалении не возвращал деньги клиенту и оставлял
  // осиротевшую revenue_abonement в журнале навсегда, хотя списание при
  // создании тапа реально произошло (см. spendWalletForZone/split-ветка в
  // POST выше). cash/mobile тут — чисто справочная пометка (никогда не
  // журналируется отдельной MoneyOperation, см. комментарий у
  // CounterTapEvent.paymentMethod в schema.prisma), возвращать нечего.
  let refundedWalletId: string | null = null;
  let refundedAmount = 0;
  try {
    await prisma.$transaction(async (tx) => {
    if (event.paymentMethod === PAYMENT_SPLIT_METHOD) {
      const abonementLegs = await tx.counterTapEventPaymentLeg.findMany({
        where: { tapId: event.id, method: "abonement" },
      });
      for (const leg of abonementLegs) {
        if (!leg.walletId) continue;
        const legAmount = Number(leg.amount);
        await tx.abonementWallet.update({ where: { id: leg.walletId }, data: { balance: { increment: legAmount } } });
        await tx.abonementTransaction.create({
          data: {
            walletId: leg.walletId,
            type: "refund",
            amount: legAmount,
            tariffId: event.tariffId,
            pointId: point.id,
            operatorId: operator.id,
          },
        });
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: event.zoneId,
            type: "revenue_abonement",
            amount: -legAmount,
            performedByOperatorId: operator.id,
          },
        });
        refundedWalletId = leg.walletId;
        refundedAmount = legAmount;
      }
    } else if (event.paymentMethod === "abonement" && event.abonementWalletId) {
      // Сумма на самом тапе не хранится (см. schema.prisma) — реконструируем
      // из текущей цены тарифа, тем же способом, что и сама трата при
      // создании тапа (spendWalletForZone, quantity:1).
      const tariff = await tx.tariff.findUnique({ where: { id: event.tariffId }, select: { price: true } });
      const amount = Number(tariff?.price ?? 0);
      if (amount > 0) {
        await tx.abonementWallet.update({
          where: { id: event.abonementWalletId },
          data: { balance: { increment: amount } },
        });
        await tx.abonementTransaction.create({
          data: {
            walletId: event.abonementWalletId,
            type: "refund",
            amount,
            tariffId: event.tariffId,
            pointId: point.id,
            operatorId: operator.id,
          },
        });
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: event.zoneId,
            type: "revenue_abonement",
            amount: -amount,
            performedByOperatorId: operator.id,
          },
        });
        refundedWalletId = event.abonementWalletId;
        refundedAmount = amount;
      }
    }
    await tx.counterTapEvent.delete({ where: { id } });
    });
  } catch (err) {
    // Гонка DELETE+DELETE/DELETE+PATCH одного и того же тапа (аудит
    // 2026-07-26) — раньше не ловилось вовсе, второй параллельный запрос
    // падал необработанным P2025 в generic 500 вместо аккуратного ответа
    // (вся транзакция откатывается, деньги не теряются и не задваиваются в
    // любом случае — это только про чистоту HTTP-ответа).
    if (isRecordNotFound(err)) {
      return NextResponse.json({ error: "Запись уже удалена" }, { status: 409 });
    }
    throw err;
  }

  if (refundedWalletId) {
    await notifyWalletBalanceChange(point.tenantId, refundedWalletId, refundedAmount).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

/**
 * Пометить/снять конкретный тап как "Возврат/тест" (запрос пользователя
 * 2026-07-25: "у конкретных активов был выбран конкретный метод оплаты" —
 * возврат должен исключать ИМЕННО свой способ оплаты из подсказки кассы, не
 * размазываться пропорционально между наличными/безналом всей зоны). Тот же
 * принцип, что Launch.voidedAt (docs/spec/04-game-room.md): тап остаётся в
 * базе и по-прежнему увеличивает показание (реальный счётчик тоже тикнул бы
 * на тестовом заезде), но выручка/подсказка его больше не считают. В отличие
 * от DELETE — обратимо (снять пометку так же легко, как поставить), это не
 * "убрать ошибку", а "пометить как не-выручку".
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/operator/tap-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.voided !== "boolean") {
    return NextResponse.json({ error: "Не указано значение voided" }, { status: 400 });
  }

  const event = await prisma.counterTapEvent.findFirst({ where: { id, pointId: point.id } });
  if (!event) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const boundary = await previousSubmissionBoundary(event.zoneId);
  if (boundary && event.createdAt <= boundary) {
    return NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 });
  }

  try {
    const updated = await prisma.counterTapEvent.update({
      where: { id },
      data: { voidedAt: body.voided ? new Date() : null },
    });
    return NextResponse.json({ id: updated.id, voidedAt: updated.voidedAt });
  } catch (err) {
    // Та же гонка, что в DELETE выше — тап мог быть удалён параллельным
    // запросом между findFirst и этим update.
    if (isRecordNotFound(err)) {
      return NextResponse.json({ error: "Запись уже удалена" }, { status: 409 });
    }
    throw err;
  }
}
