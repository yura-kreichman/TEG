import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  computeLaunchAmount,
  roundToWholeCurrencyUnit,
  LAUNCH_PAYMENT_METHODS,
  LAUNCH_LOCK_TIMEOUT_MS,
  type LaunchPricingMode,
  type LaunchRoundingMode,
} from "@/lib/game-room";
import { InsufficientBalanceError, spendWalletTx, notifyWalletBalanceChange } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { PAYMENT_SPLIT_METHOD, validateSplitLegs, InvalidPaymentSplitError, type PaymentLegInput } from "@/lib/payment-split";

class LaunchAlreadyStoppedError extends Error {}

// Стоп пуска — оператор, серверное время; расчёт стоимости только на сервере
// (docs/spec/04-game-room.md), по снапшоту тарифа, зафиксированному при
// старте (см. /api/zones/[id]/launches POST), не по текущему тарифу зоны.
export async function POST(request: Request, ctx: RouteContext<"/api/launches/[id]/stop">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id } = await ctx.params;

  const launch = await prisma.launch.findUnique({ where: { id }, include: { zone: true } });
  if (!launch || launch.zone.pointId !== point.id) {
    return NextResponse.json({ error: "Пуск не найден" }, { status: 404 });
  }
  // !isOpen — либо УЖЕ полностью завершён (paymentMethod задан), либо только
  // "заморожен" через /lock и ждёт способ оплаты (paymentMethod ещё null,
  // см. lock/route.ts) — второе допустимо, сумма/endedAt уже зафиксированы
  // там, здесь их не пересчитываем заново (см. isLocked ниже).
  if (!launch.isOpen && launch.paymentMethod !== null) {
    return NextResponse.json({ error: "Пуск уже завершён" }, { status: 400 });
  }
  const isLocked = !launch.isOpen;
  // Тайм-аут "заморозки" (запрос пользователя 2026-07-27, реальный риск
  // злоупотребления: зафиксировать заниженную сумму рано и не оплачивать,
  // забирая разницу мимо кассы наличными, пока ребёнок физически продолжает
  // играть) — просроченную заморозку не принимаем, возвращаем пуск в идущий
  // и просим повторить остановку заново с актуальным временем.
  if (isLocked && launch.endedAt && Date.now() - launch.endedAt.getTime() > LAUNCH_LOCK_TIMEOUT_MS) {
    await prisma.launch.updateMany({
      where: { id, isOpen: false, paymentMethod: null },
      data: { isOpen: true, endedAt: null, amount: null, endedByOperatorId: null },
    });
    return NextResponse.json({ error: "Пауза истекла — пуск возобновлён, остановите заново" }, { status: 409 });
  }
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: launch.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) {
      return NextResponse.json({ error: "Нет доступа к этой зоне" }, { status: 403 });
    }
  }

  // Способ оплаты — только у "per_minute"/"По факту" спрашивается СЕЙЧАС,
  // при остановке (запрос пользователя 2026-07-17: "это только касается
  // тарифа По факту") — у "fixed"/"За вход" он уже известен, спрошен и
  // сохранён РАНЬШЕ, при старте (см. POST /api/zones/[id]/launches). Реальный
  // баг, найден пользователем 2026-07-18 через живой пуск "За вход": здесь
  // paymentMethod/abonementWalletId раньше безусловно перезаписывались
  // локальной переменной null для ЛЮБОГО режима — стоп "За вход"-пуска стирал
  // уже сохранённый способ оплаты, из-за чего разбивка Наличные/Безнал/
  // Абонемент по активу всегда показывала 0 у "За вход", хотя расчётная
  // выручка была верной. Для "fixed" сохраняем то, что уже записано на
  // самом пуске, вместо null.
  let paymentMethod: string | null = launch.paymentMethod;
  let abonementWalletId: string | null = launch.abonementWalletId;
  // Разбивка оплаты (запрос пользователя 2026-07-26) — тот же принцип, что
  // у "fixed" при старте, только тут сумма известна лишь сейчас (см.
  // computeLaunchAmount ниже), поэтому сумма долей сверяется ПОСЛЕ него.
  let legs: PaymentLegInput[] | undefined;
  if (launch.pricingMode === "per_minute") {
    const body = await request.json().catch(() => ({}));
    legs = Array.isArray(body.legs)
      ? (body.legs as unknown[]).map((raw) => {
          const l = raw as { method?: unknown; amount?: unknown; walletId?: unknown };
          return {
            method: typeof l?.method === "string" ? l.method : "",
            amount: Number(l?.amount),
            walletId: typeof l?.walletId === "string" ? l.walletId : undefined,
          };
        })
      : undefined;
    if (legs) {
      paymentMethod = PAYMENT_SPLIT_METHOD;
      abonementWalletId = null;
      if (legs.some((l) => l.method === "abonement") && !(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
        return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
      }
    } else {
      if (!(LAUNCH_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
        return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
      }
      paymentMethod = body.paymentMethod;
      if (paymentMethod === "abonement") {
        if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
          return NextResponse.json({ error: "Оплата балансом отключена владельцем" }, { status: 403 });
        }
        abonementWalletId =
          typeof body.abonementWalletId === "string" && body.abonementWalletId ? body.abonementWalletId : null;
        if (!abonementWalletId) {
          return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
        }
      } else {
        abonementWalletId = null;
      }
    }
  }

  // Уже "заморожен" (см. /api/launches/[id]/lock) — endedAt/amount там уже
  // зафиксированы серверным временем в момент открытия шторки, здесь их не
  // трогаем заново (иначе сумма продолжила бы расти, ровно то, что должно
  // было прекратиться после заморозки). Иначе (обычный стоп "fixed" — тот
  // никогда не проходит через /lock, у него цена и так известна заранее) —
  // считаем как раньше.
  const endedAt = isLocked ? launch.endedAt! : new Date();
  let amount = isLocked
    ? Number(launch.amount)
    : computeLaunchAmount(
        {
          pricingMode: launch.pricingMode as LaunchPricingMode,
          priceSnapshot: launch.priceSnapshot,
          durationMinutesSnapshot: launch.durationMinutesSnapshot,
          roundingModeSnapshot: launch.roundingModeSnapshot as LaunchRoundingMode | null,
          minAmountSnapshot: launch.minAmountSnapshot,
        },
        launch.startedAt,
        endedAt
      );
  // Округление суммы до целой валютной единицы (запрос пользователя
  // 2026-07-27) — только "per_minute", "fixed" уже целая цена владельца;
  // уже применено при заморозке, если isLocked — повторно не округляем.
  if (!isLocked && launch.pricingMode === "per_minute" && launch.zone.amountRoundingEnabled) {
    amount = roundToWholeCurrencyUnit(amount);
  }
  if (legs) {
    try {
      validateSplitLegs(legs, amount, LAUNCH_PAYMENT_METHODS);
    } catch (err) {
      if (err instanceof InvalidPaymentSplitError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // CAS вместо обычного update (аудит 2026-07-25: проверка !launch.isOpen
      // выше читалась ДО транзакции — двойной клик "Стоп" на одном пуске с
      // оплатой балансом "По факту" мог пройти её дважды и дважды списать
      // ту же сумму с кошелька через spendWalletTx) — если пуск уже
      // остановлен/оплачен параллельным запросом, updateMany затронет 0
      // строк. Два варианта where в зависимости от isLocked: обычный стоп
      // требует ещё isOpen:true (переход из идущего), довершение уже
      // "замороженного" пуска (см. /lock) требует isOpen:false +
      // paymentMethod:null (переход из "ждёт оплату" в "оплачен") — иначе
      // легитимный стоп уже "замороженного" пуска сам себя бы отклонял.
      const stopResult = await tx.launch.updateMany({
        where: isLocked ? { id, isOpen: false, paymentMethod: null } : { id, isOpen: true },
        data: { endedAt, isOpen: false, amount, endedByOperatorId: operator.id, paymentMethod, abonementWalletId },
      });
      if (stopResult.count === 0) throw new LaunchAlreadyStoppedError();

      // Сумма "По факту" известна только сейчас, при остановке — списание
      // сразу здесь же, тем же принципом, что и "За вход" при старте.
      // ТОЛЬКО "per_minute" — у "fixed" списание уже прошло раньше, при
      // старте (см. POST /api/zones/[id]/launches), повторное списание тут
      // задвоило бы его.
      if (legs) {
        for (const leg of legs) {
          if (leg.method === "abonement") {
            await spendWalletTx(tx, leg.walletId!, {
              tenantId: point.tenantId,
              zoneId: launch.zoneId,
              launchId: id,
              pointId: point.id,
              operatorId: operator.id,
              amount: leg.amount,
            });
          }
        }
        await tx.launchPaymentLeg.createMany({
          data: legs.map((leg, index) => ({
            launchId: id,
            method: leg.method,
            amount: leg.amount,
            walletId: leg.walletId,
            order: index,
          })),
        });
      } else if (launch.pricingMode === "per_minute" && paymentMethod === "abonement" && abonementWalletId) {
        await spendWalletTx(tx, abonementWalletId, {
          tenantId: point.tenantId,
          zoneId: launch.zoneId,
          launchId: id,
          pointId: point.id,
          operatorId: operator.id,
          amount,
        });
      }

      return tx.launch.findUniqueOrThrow({ where: { id } });
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: "Недостаточно средств на абонементе" }, { status: 400 });
    }
    if (err instanceof LaunchAlreadyStoppedError) {
      return NextResponse.json({ error: "Пуск уже завершён" }, { status: 409 });
    }
    throw err;
  }

  if (legs) {
    const abonementLeg = legs.find((l) => l.method === "abonement");
    if (abonementLeg) {
      await notifyWalletBalanceChange(point.tenantId, abonementLeg.walletId!, -abonementLeg.amount).catch(() => {});
    }
  } else if (launch.pricingMode === "per_minute" && paymentMethod === "abonement" && abonementWalletId) {
    await notifyWalletBalanceChange(point.tenantId, abonementWalletId, -amount).catch(() => {});
  }

  return NextResponse.json({
    id: updated.id,
    startedAt: updated.startedAt,
    endedAt: updated.endedAt,
    amount: Number(updated.amount),
    paymentMethod: updated.paymentMethod,
  });
}
