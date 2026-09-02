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
 * Вернуть клиенту деньги, списанные с баланса за этот тап.
 *
 * Один помощник на два пути — удаление тапа и пометку «Возврат/тест»
 * (генеральная проверка финансов 2026-09-02, С6). До этого возврат жил только
 * в DELETE: пометка ставила voidedAt и на этом всё, деньги клиенту не
 * возвращались, строки «Возврат» в его выписке не появлялось, пуша не было.
 * Исход зависел от того, какую из двух кнопок нажал сотрудник — при том что
 * спека (docs/spec/04-game-room.md:51) требует возврата, и у Пусков он давно
 * реализован.
 *
 * Сумма реконструируется из ТЕКУЩЕЙ цены тарифа: на самом тапе она не
 * хранится (см. schema.prisma) — тем же способом, что и списание при создании
 * (spendWalletForZone, quantity: 1). cash/mobile здесь чисто справочная
 * пометка, отдельной MoneyOperation не журналируется, возвращать нечего.
 *
 * Возвращает кошелёк и сумму для пуша о смене баланса — либо нули, если
 * возвращать было нечего.
 */
async function refundTapPayment(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    zoneId: string;
    tariffId: string;
    paymentMethod: string | null;
    abonementWalletId: string | null;
    priceSnapshot: Prisma.Decimal | null;
  },
  point: { id: string; tenantId: string },
  operatorId: string
): Promise<{ walletId: string | null; amount: number }> {
  let walletId: string | null = null;
  let amount = 0;

  const credit = async (targetWalletId: string, value: number) => {
    if (value <= 0) return;
    await tx.abonementWallet.update({ where: { id: targetWalletId }, data: { balance: { increment: value } } });
    await tx.abonementTransaction.create({
      data: {
        walletId: targetWalletId,
        type: "refund",
        amount: value,
        tariffId: event.tariffId,
        pointId: point.id,
        operatorId,
      },
    });
    await tx.moneyOperation.create({
      data: {
        tenantId: point.tenantId,
        zoneId: event.zoneId,
        type: "revenue_abonement",
        amount: -value,
        performedByOperatorId: operatorId,
      },
    });
    walletId = targetWalletId;
    amount += value;
  };

  if (event.paymentMethod === PAYMENT_SPLIT_METHOD) {
    const abonementLegs = await tx.counterTapEventPaymentLeg.findMany({
      where: { tapId: event.id, method: "abonement" },
    });
    for (const leg of abonementLegs) {
      if (!leg.walletId) continue;
      await credit(leg.walletId, Number(leg.amount));
    }
  } else if (event.paymentMethod === "abonement" && event.abonementWalletId) {
    // Цена НА МОМЕНТ ТАПА (генеральная проверка финансов 2026-09-02). Раньше
    // читалась текущая цена тарифа: подняли её с 35 до 50, удалили старый
    // ошибочный тап — клиенту вернулось 50 вместо списанных 35. У разбивки
    // (ветка выше) суммы долей хранятся, и там возврат был верен с самого
    // начала — а рядом стоял этот же случай без снапшота.
    // NULL — тап старше миграции, там взять неоткуда, берём текущую.
    const price =
      event.priceSnapshot ??
      (await tx.tariff.findUnique({ where: { id: event.tariffId }, select: { price: true } }))?.price ??
      0;
    await credit(event.abonementWalletId, Number(price));
  }

  return { walletId, amount };
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
  // Возврат — тем же помощником, что и пометка «Возврат/тест» ниже (С6).
  // Раньше эта логика жила здесь единственным экземпляром, и PATCH её просто
  // не имел: деньги возвращались или нет в зависимости от того, какую кнопку
  // нажал сотрудник.
  let refundedWalletId: string | null = null;
  let refundedAmount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Возврат только если он ЕЩЁ НЕ СДЕЛАН. Пометка «Возврат/тест» уже
      // возвращает деньги (С6), а кнопка «Удалить» рядом с ней не пропадает —
      // сотрудник мог нажать обе подряд и зачислить клиенту двойную цену, с
      // двумя минусовыми revenue_abonement в журнале. Найдено перепроверкой
      // 2026-09-03: общий помощник закрыл одну дыру и открыл эту.
      if (!event.voidedAt) {
        const refund = await refundTapPayment(tx, event, { id: point.id, tenantId: point.tenantId }, operator.id);
        refundedWalletId = refund.walletId;
        refundedAmount = refund.amount;
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
  const { point, operator } = opCtx;
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
    // Пометка «Возврат/тест» ВОЗВРАЩАЕТ деньги, списанные с баланса, — ровно
    // как удаление тапа (С6). Смена состояния через updateMany с условием на
    // текущее значение: без неё двойной клик вернул бы деньги дважды.
    //
    // Снятие пометки деньги обратно НЕ списывает намеренно. Симметричное
    // повторное списание могло бы упереться в нехватку баланса и оставить
    // систему в состоянии «тап учтён, а денег нет»; вместо этого возврат
    // остаётся отдельным честным событием в выписке клиента, а сотрудник,
    // передумав, оформляет новый тап. Это тот же принцип, что у аннулирования
    // Билетов: возврат — текущее событие кассы, а не откат прошлого.
    const refundResult = await prisma.$transaction(async (tx) => {
      const changed = await tx.counterTapEvent.updateMany({
        where: { id, voidedAt: body.voided ? null : { not: null } },
        data: { voidedAt: body.voided ? new Date() : null },
      });
      if (changed.count === 0) return null;
      if (!body.voided) return { walletId: null, amount: 0 };
      return refundTapPayment(tx, event, { id: point.id, tenantId: point.tenantId }, operator.id);
    });

    const updated = await prisma.counterTapEvent.findUnique({ where: { id }, select: { id: true, voidedAt: true } });
    if (!updated) {
      return NextResponse.json({ error: "Запись уже удалена" }, { status: 409 });
    }
    if (refundResult?.walletId && refundResult.amount > 0) {
      notifyWalletBalanceChange(point.tenantId, refundResult.walletId, refundResult.amount).catch(() => {});
    }
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
