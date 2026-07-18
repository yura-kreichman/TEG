import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Модуль "Абонементы" (запрос пользователя 2026-07-17) — Abonement — это
// ТАРИФ-ПЛАН владельца ("заплатить price → зачислить creditAmount"), БЕЗ
// привязки к клиенту; AbonementWallet — внутренний кошелёк клиента,
// идентификатор — номер телефона, появляется ТОЛЬКО как побочный эффект
// покупки какого-то плана оператором (владелец не создаёт кошельки вручную —
// "неправильно, что я добавил абонемент и просто указал баланс, нет
// логики"). И баланс кошелька, и сам план — общие на весь тенант, без
// привязки к точкам ("один номер работает на любой точке компании"; план
// изначально был ограничиваем по точкам, убрано запросом пользователя
// 2026-07-18: "просто зачисляется клиенту" — точка нужна только в момент
// самой оплаты, куда пришли деньги, не как атрибут плана). Пополнение и трата
// — РАЗНЫЕ бухгалтерские события (решение пользователя того же дня): пополнение
// — аванс клиента, трогает физическую кассу точки (если платил наличными),
// но НЕ "Выручку"/"Прибыль" бизнеса; трата — наоборот, признаёт "Выручку"
// зоны в момент оплаты пуска, но кассу не трогает (реальных денег в этот
// момент не приходит — они уже пришли при пополнении). Два разных
// MoneyOperation.type на каждую сторону, см. dispatch ниже.

export const ABONEMENT_TOPUP_PAYMENT_METHODS = ["cash", "mobile"] as const;
export type AbonementTopupPaymentMethod = (typeof ABONEMENT_TOPUP_PAYMENT_METHODS)[number];

type Tx = Prisma.TransactionClient;

/** Только цифры — так "+7 999 123-45-67" и "79991234567" считаются одним номером. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function findWalletByPhone(tenantId: string, rawPhone: string, tx: Tx | typeof prisma = prisma) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  return tx.abonementWallet.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
}

/** Список планов тенанта — всегда видны на всех точках (см. комментарий выше). */
export async function listAbonements(tenantId: string, tx: Tx | typeof prisma = prisma) {
  return tx.abonement.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { order: "asc" },
  });
}

// MoneyOperation.type для пополнения — раздельно по способу оплаты, тем же
// принципом, что revenue/revenue_cashless: наличные трогают физическую
// кассу точки (getPointCashBalance читает ЛЮБОЙ тип, кроме явно исключённых
// — см. src/lib/zone-balance.ts), безнал/абонемент-пополнение безналом —
// нет. Ни один из двух НЕ входит в "Выручку"/"Прибыль" — это аванс.
export function abonementTopupMoneyType(paymentMethod: AbonementTopupPaymentMethod): string {
  return paymentMethod === "cash" ? "abonement_topup" : "abonement_topup_cashless";
}

// "Кто продал/пополнил" — оператор (экран оплаты пуска, кнопка "Абонементы"
// в нижнем баре) ИЛИ владелец (кабинет /abonements, запрос пользователя
// 2026-07-17: "это может делать как Владелец, так и Сотрудник"). Ровно один
// из двух, тот же приём, что MoneyOperation.performedByUserId/
// performedByOperatorId.
type Actor = { operatorId: string; userId?: undefined } | { userId: string; operatorId?: undefined };

interface TopupParams {
  tenantId: string;
  pointId: string;
  abonementId: string;
  paymentMethod: AbonementTopupPaymentMethod;
  actor: Actor;
}

/**
 * Пополнение существующего кошелька — планом владельца (запрос пользователя
 * 2026-07-17: "фиксированные пакеты"), сумма зачисления берётся из
 * Abonement.creditAmount, а не price (бонус). Атомарно: баланс + журнал
 * кошелька + денежный след кассы точки одной транзакцией.
 */
export async function topUpWallet(walletId: string, params: TopupParams) {
  const { tenantId, pointId, abonementId, paymentMethod, actor } = params;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.abonement.findFirst({
      where: { id: abonementId, tenantId, deletedAt: null },
    });
    if (!plan) throw new Error("ABONEMENT_NOT_FOUND");

    const wallet = await tx.abonementWallet.update({
      where: { id: walletId },
      data: { balance: { increment: plan.creditAmount } },
    });

    await tx.abonementTransaction.create({
      data: {
        walletId,
        type: "topup",
        amount: plan.creditAmount,
        abonementId: plan.id,
        paymentMethod,
        pointId,
        operatorId: actor.operatorId,
        userId: actor.userId,
      },
    });

    await tx.moneyOperation.create({
      data: {
        tenantId,
        pointId,
        type: abonementTopupMoneyType(paymentMethod),
        amount: plan.price,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });

    return wallet;
  });
}

/**
 * Регистрация нового абонента БЕЗ покупки/пополнения абонемента (запрос
 * пользователя 2026-07-18: "чтобы сотрудник мог завести нового абонента, но
 * не продавать сам абонимент — может человек потом захочет") — кошелёк с
 * нулевым балансом, без AbonementTransaction и без MoneyOperation (денег не
 * было). И Владелец, и Сотрудник могут вызвать — точки тут не нужно, деньги
 * не двигаются вообще.
 */
export async function createWalletEmpty(rawPhone: string, name: string | null, tenantId: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("INVALID_PHONE");
  return prisma.abonementWallet.create({ data: { tenantId, phone, name: name || null, balance: 0 } });
}

/**
 * Первое пополнение по ещё не существующему номеру — создаёт кошелёк и сразу
 * пополняет (запрос пользователя 2026-07-17: "оператор, прямо в момент
 * оплаты"). Отдельная функция, а не findOrCreate внутри topUpWallet — тут
 * нужен phone/name, там нет.
 */
export async function createWalletWithTopup(rawPhone: string, name: string | null, params: TopupParams) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("INVALID_PHONE");
  const { tenantId, pointId, abonementId, paymentMethod, actor } = params;

  return prisma.$transaction(async (tx) => {
    const plan = await tx.abonement.findFirst({
      where: { id: abonementId, tenantId, deletedAt: null },
    });
    if (!plan) throw new Error("ABONEMENT_NOT_FOUND");

    const wallet = await tx.abonementWallet.create({
      data: { tenantId, phone, name: name || null, balance: plan.creditAmount },
    });

    await tx.abonementTransaction.create({
      data: {
        walletId: wallet.id,
        type: "topup",
        amount: plan.creditAmount,
        abonementId: plan.id,
        paymentMethod,
        pointId,
        operatorId: actor.operatorId,
        userId: actor.userId,
      },
    });

    await tx.moneyOperation.create({
      data: {
        tenantId,
        pointId,
        type: abonementTopupMoneyType(paymentMethod),
        amount: plan.price,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });

    return wallet;
  });
}

/**
 * Пополнение существующего кошелька на ПРОИЗВОЛЬНУЮ сумму владельцем —
 * трактуется КАК НАЛИЧНЫЙ РАСЧЁТ (решение пользователя 2026-07-17: "это
 * должно быть как Наличный расчёт... это как бы из его денег" — владелец
 * условно кладёт в кассу точки свои собственные деньги, отсюда и
 * MoneyOperation типа abonement_topup, ровно как у обычного пополнения
 * наличными, трогает кассу точки). AbonementTransaction при этом остаётся
 * "adjustment" (не "topup") — так в истории кошелька видно, что зачисление
 * было ручным решением владельца, а не покупкой конкретного плана; на
 * бухгалтерию это уже не влияет, только на подпись в истории.
 */
export async function adjustWalletBalance(
  walletId: string,
  tenantId: string,
  pointId: string,
  amount: number,
  userId: string
) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.update({
      where: { id: walletId },
      data: { balance: { increment: amount } },
    });

    await tx.abonementTransaction.create({
      data: { walletId, type: "adjustment", amount, pointId, userId },
    });

    await tx.moneyOperation.create({
      data: { tenantId, pointId, type: "abonement_topup", amount, performedByUserId: userId },
    });

    return wallet;
  });
}

/** Аналог createWalletWithTopup, но произвольной суммой (см. adjustWalletBalance выше). */
export async function createWalletWithAdjustment(
  rawPhone: string,
  name: string | null,
  tenantId: string,
  pointId: string,
  amount: number,
  userId: string
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("INVALID_PHONE");

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.create({
      data: { tenantId, phone, name: name || null, balance: amount },
    });

    await tx.abonementTransaction.create({
      data: { walletId: wallet.id, type: "adjustment", amount, pointId, userId },
    });

    await tx.moneyOperation.create({
      data: { tenantId, pointId, type: "abonement_topup", amount, performedByUserId: userId },
    });

    return wallet;
  });
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("INSUFFICIENT_BALANCE");
  }
}

interface SpendParams {
  tenantId: string;
  zoneId: string;
  launchId: string;
  pointId: string;
  operatorId: string;
  amount: number;
}

/**
 * Списание на оплату пуска — сразу в момент выбора способа оплаты, не
 * откладывается до сдачи итогов (запрос пользователя 2026-07-17: "в момент
 * траты" признаётся "Выручка"). Уйти в минус нельзя (подтверждено
 * пользователем) — обновление баланса условное (WHERE balance >= amount),
 * 0 обновлённых строк = недостаточно средств, без гонки между операторами.
 *
 * Принимает ЧУЖОЙ открытый tx (не открывает свой) — вызывающий роут уже
 * ведёт свою транзакцию создания/закрытия Launch (нужен launchId ДО вызова,
 * "За вход"/"Пуски" создают Launch первым шагом той же транзакции, "По
 * факту" его уже обновляет), и списание должно быть частью той же атомарной
 * операции — если Launch не сохранится, баланс не должен списаться, и наоборот.
 */
export async function spendWalletTx(tx: Tx, walletId: string, params: SpendParams) {
  const { tenantId, zoneId, launchId, pointId, operatorId, amount } = params;
  const updated = await tx.abonementWallet.updateMany({
    where: { id: walletId, tenantId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (updated.count === 0) throw new InsufficientBalanceError();

  await tx.abonementTransaction.create({
    data: { walletId, type: "spend", amount, launchId, pointId, operatorId },
  });

  await tx.moneyOperation.create({
    data: {
      tenantId,
      zoneId,
      type: "revenue_abonement",
      amount,
      performedByOperatorId: operatorId,
    },
  });

  return tx.abonementWallet.findUniqueOrThrow({ where: { id: walletId } });
}
