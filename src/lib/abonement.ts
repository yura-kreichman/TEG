import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sendChatMessage } from "@/lib/telegram-bot";
import { formatMoneyWithCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/currency";
import { BOT_STRINGS, greetingLine } from "@/lib/telegram-client-i18n";
import type { Locale } from "@/lib/locales";

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

// Уже привязал Telegram-бота (запрос пользователя 2026-07-23: "если клиент
// уже есть в Telegram, ему печатать QR/предлагать привязку не нужно") — он
// уже знает, как проверить баланс сам, показывать это ещё раз только шум.
export async function hasTelegramLink(tenantId: string, phone: string): Promise<boolean> {
  const link = await prisma.clientTelegramLink.findFirst({ where: { tenantId, phone }, select: { id: true } });
  return !!link;
}

// Пуш клиенту в Telegram при любом изменении баланса кошелька (запрос
// пользователя 2026-07-22: "проактивные уведомления о балансе — надо
// обязательно реализовать"). ВСЕГДА вызывается ПОСЛЕ того, как транзакция,
// изменившая баланс, уже закоммитилась (никогда изнутри prisma.$transaction)
// — тот же принцип, что уже используется в вебхуке привязки чата Владельца
// ("сеть может зависнуть/упасть без влияния на консистентность записанного").
// Читает баланс заново из БД, а не берёт из результата транзакции — так
// сообщение всегда отражает ФАКТИЧЕСКИ сохранённое состояние, даже если этот
// вызов случайно запоздал относительно другой параллельной операции. amount —
// подписанная дельта (+ пополнение/возврат, − списание), только для текста
// сообщения, на итоговый баланс не влияет. Молча ничего не делает, если у
// клиента нет привязанного Telegram-чата — это норма, не ошибка.
export async function notifyWalletBalanceChange(tenantId: string, walletId: string, amount: number): Promise<void> {
  const wallet = await prisma.abonementWallet.findUnique({ where: { id: walletId }, select: { name: true, phone: true, balance: true } });
  if (!wallet) return;

  const links = await prisma.clientTelegramLink.findMany({ where: { tenantId, phone: wallet.phone } });
  if (links.length === 0) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) return;

  const currency = tenant.currency as CurrencyCode | null;
  const sign = amount >= 0 ? "+" : "−";

  // Язык — из привязки чата (сохранён один раз при первой проверке контакта,
  // см. вебхук), не из живого Telegram-апдейта: тут его попросту нет, это
  // проактивный пуш, а не ответ на сообщение клиента.
  for (const link of links) {
    const s = BOT_STRINGS[link.language as Locale] ?? BOT_STRINGS.en;
    const text = [
      greetingLine(wallet.name, s),
      `${sign}${formatMoneyWithCurrency(Math.abs(amount), "ru", currency)}`,
      `${s.balanceWord}: <b>${formatMoneyWithCurrency(Number(wallet.balance), "ru", currency)}</b>`,
    ].join("\n");
    await sendChatMessage(link.chatId, text).catch(() => {});
  }
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
  const { wallet, creditAmount } = await prisma.$transaction(async (tx) => {
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
        abonementId: plan.id,
        type: abonementTopupMoneyType(paymentMethod),
        amount: plan.price,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });

    return { wallet, creditAmount: Number(plan.creditAmount) };
  });

  await notifyWalletBalanceChange(tenantId, walletId, creditAmount).catch(() => {});
  return wallet;
}

interface ArbitraryTopupParams {
  tenantId: string;
  pointId: string;
  amount: number;
  paymentMethod: AbonementTopupPaymentMethod;
  actor: Actor;
}

/**
 * Пополнение существующего кошелька Сотрудником на ПРОИЗВОЛЬНУЮ сумму
 * (запрос пользователя 2026-07-19) — в отличие от adjustWalletBalance
 * (Владелец, ниже) это РЕАЛЬНОЕ кассовое событие: деньги физически получены
 * оператором на точке, поэтому обязателен способ оплаты и создаётся
 * MoneyOperation, ровно как у topUpWallet — просто amount берётся напрямую
 * из запроса, а не из Abonement.creditAmount/price (нет фиксированного
 * плана, cумма оплаты == сумма зачисления).
 */
export async function topUpWalletArbitrary(walletId: string, params: ArbitraryTopupParams) {
  const { tenantId, pointId, amount, paymentMethod, actor } = params;
  const wallet = await prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.update({
      where: { id: walletId },
      data: { balance: { increment: amount } },
    });

    await tx.abonementTransaction.create({
      data: {
        walletId,
        type: "topup",
        amount,
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
        amount,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });

    return wallet;
  });

  await notifyWalletBalanceChange(tenantId, walletId, amount).catch(() => {});
  return wallet;
}

/** Аналог createWalletWithTopup, но произвольной суммой Сотрудника (см. topUpWalletArbitrary выше). */
export async function createWalletWithTopupArbitrary(
  rawPhone: string,
  name: string | null,
  params: ArbitraryTopupParams
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("INVALID_PHONE");
  const { tenantId, pointId, amount, paymentMethod, actor } = params;

  const wallet = await prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.create({
      data: { tenantId, phone, name: name || null, balance: amount },
    });

    await tx.abonementTransaction.create({
      data: {
        walletId: wallet.id,
        type: "topup",
        amount,
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
        amount,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });

    return wallet;
  });

  // Кошелёк только что создан — привязанного Telegram-чата по определению
  // ещё нет, notifyWalletBalanceChange() тут молча ничего не пришлёт. Вызов
  // всё равно оставлен для единообразия/на случай будущей привязки до
  // первого пополнения.
  await notifyWalletBalanceChange(tenantId, wallet.id, amount).catch(() => {});
  return wallet;
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

  const wallet = await prisma.$transaction(async (tx) => {
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
        abonementId: plan.id,
        type: abonementTopupMoneyType(paymentMethod),
        amount: plan.price,
        performedByOperatorId: actor.operatorId,
        performedByUserId: actor.userId,
      },
    });

    return wallet;
  });

  // Кошелёк только что создан — привязанного Telegram-чата ещё нет, см.
  // тот же комментарий в createWalletWithTopupArbitrary выше.
  await notifyWalletBalanceChange(tenantId, wallet.id, Number(wallet.balance)).catch(() => {});
  return wallet;
}

/**
 * Пополнение существующего кошелька на ПРОИЗВОЛЬНУЮ сумму владельцем — НЕ
 * кассовая операция и не привязана к точке (решение пользователя
 * 2026-07-18, отменяет прежнее решение от 2026-07-17 "как бы из его денег,
 * трогает кассу точки": "Владелец если хочет может произвольно пополнить
 * баланс, но это нигде не должно учитываться" — продаёт план и берёт
 * реальные деньги только Сотрудник, см. createWalletWithTopup/topUpWallet
 * выше). Чистое изменение баланса кошелька + запись в истории (type
 * "adjustment"), без MoneyOperation.
 */
export async function adjustWalletBalance(walletId: string, amount: number, userId: string) {
  const wallet = await prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.update({
      where: { id: walletId },
      data: { balance: { increment: amount } },
    });

    await tx.abonementTransaction.create({
      data: { walletId, type: "adjustment", amount, userId },
    });

    return wallet;
  });

  await notifyWalletBalanceChange(wallet.tenantId, walletId, amount).catch(() => {});
  return wallet;
}

/** Аналог createWalletWithTopup, но произвольной суммой (см. adjustWalletBalance выше). */
export async function createWalletWithAdjustment(
  rawPhone: string,
  name: string | null,
  tenantId: string,
  amount: number,
  userId: string
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("INVALID_PHONE");

  const wallet = await prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.create({
      data: { tenantId, phone, name: name || null, balance: amount },
    });

    await tx.abonementTransaction.create({
      data: { walletId: wallet.id, type: "adjustment", amount, userId },
    });

    return wallet;
  });

  await notifyWalletBalanceChange(tenantId, wallet.id, amount).catch(() => {});
  return wallet;
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("INSUFFICIENT_BALANCE");
  }
}

// Ровно один вариант: "Счётчики" — оплата привязана к конкретному
// активу+тарифу (нужны для отчётности "какая поездка"); "Только касса" — у
// зоны вообще нет активов/тарифов (docs/spec/01-counters.md), привязывать
// оплату не к чему, только к самой зоне.
type ZoneSpendTarget = { kind: "counterAsset"; assetId: string; tariffId: string } | { kind: "cashOnlyZone"; zoneId: string };

interface ZoneSpendParams {
  tenantId: string;
  pointId: string;
  operatorId: string;
  amount: number;
  target: ZoneSpendTarget;
}

/**
 * Оплата балансом на зоне без Launch-учёта — режимы "Счётчики" и "Только
 * касса" (docs/spec/01-counters.md, запрос пользователя 2026-07-20: "как
 * сделать, чтобы... клиенты могли оплатить балансом", затем "актуально не
 * только для счётчиков, но и Только касса"). В отличие от Пусков/Прибываний
 * тут НЕТ отдельной записи на сеанс — на "Счётчиках" счётчик тикает физически
 * по RFID-метке, программа об этом не знает, а "Только касса" вообще не
 * ведёт по-активный учёт — эта функция только независимая ручная фиксация
 * Сотрудником факта оплаты, не связанная с самим тиком/кассой.
 */
export async function spendWalletForZone(walletId: string, params: ZoneSpendParams) {
  const { tenantId, pointId, operatorId, amount, target } = params;

  return prisma.$transaction(async (tx) => {
    let zoneId: string;
    let assetId: string | null = null;
    let tariffId: string | null = null;

    if (target.kind === "counterAsset") {
      const asset = await tx.asset.findFirst({
        where: { id: target.assetId, zone: { pointId, point: { tenantId }, accountingMode: "counters" } },
        select: { zoneId: true },
      });
      if (!asset) throw new Error("ASSET_NOT_FOUND");
      const tariff = await tx.tariff.findFirst({ where: { id: target.tariffId, zoneId: asset.zoneId, deletedAt: null } });
      if (!tariff) throw new Error("TARIFF_NOT_FOUND");
      zoneId = asset.zoneId;
      assetId = target.assetId;
      tariffId = target.tariffId;
    } else {
      const zone = await tx.zone.findFirst({
        where: { id: target.zoneId, pointId, point: { tenantId }, accountingMode: "cash_only" },
        select: { id: true },
      });
      if (!zone) throw new Error("ZONE_NOT_FOUND");
      zoneId = zone.id;
    }

    const updated = await tx.abonementWallet.updateMany({
      where: { id: walletId, tenantId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (updated.count === 0) throw new InsufficientBalanceError();

    await tx.abonementTransaction.create({
      data: { walletId, type: "spend", amount, assetId, tariffId, pointId, operatorId },
    });

    await tx.moneyOperation.create({
      data: { tenantId, zoneId, type: "revenue_abonement", amount, performedByOperatorId: operatorId },
    });

    return tx.abonementWallet.findUniqueOrThrow({ where: { id: walletId } });
  }).then(async (wallet) => {
    await notifyWalletBalanceChange(tenantId, walletId, -amount).catch(() => {});
    return wallet;
  });
}

/**
 * Абонементная сумма, собранная по зоне (режимы "Счётчики"/"Только касса") с
 * прошлой сдачи итогов (или с начала времён, если её ещё не было) — та же
 * роль, что агрегат Launch.paymentMethod="abonement" у Пусков/Прибываний,
 * только источник другой: у этих режимов нет Launch, только
 * MoneyOperation(type: "revenue_abonement") на зоне (см. spendWalletForZone) —
 * читаем напрямую по zoneId, не через активы (у "Только касса" их нет вовсе).
 */
export async function getZoneAbonementSpendAmount(zoneId: string, since: Date | null): Promise<number> {
  const ops = await prisma.moneyOperation.findMany({
    where: {
      zoneId,
      type: "revenue_abonement",
      ...(since ? { occurredAt: { gt: since } } : {}),
    },
    select: { amount: true },
  });
  return Math.round(ops.reduce((sum, op) => sum + Number(op.amount), 0) * 100) / 100;
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

interface TicketOrderSpendParams {
  tenantId: string;
  zoneId: string;
  ticketOrderId: string;
  pointId: string;
  operatorId: string;
  amount: number;
}

/**
 * Списание на оплату заказа билетов — тот же принцип, что spendWalletTx
 * выше (docs/spec/10-tickets.md, "ЗАКАЗ": "списание с кошелька — при
 * продаже, атомарно"), просто ticketOrderId вместо launchId — оплата
 * признаётся "Выручкой" сразу в момент продажи, не откладывается до сдачи
 * итогов (тот же revenue_abonement, что у Пусков/Прибываний/Счётчиков —
 * "поштучно нет операций" из спеки касается только нал/безнал, абонемент
 * везде в проекте — исключение, реальные деньги уже пришли раньше).
 * Принимает ЧУЖОЙ открытый tx — вызывающий роут уже ведёт транзакцию
 * создания заказа+билетов, списание должно быть её частью (если заказ не
 * сохранится, баланс не должен списаться, и наоборот).
 */
export async function spendWalletForTicketOrderTx(tx: Tx, walletId: string, params: TicketOrderSpendParams) {
  const { tenantId, zoneId, ticketOrderId, pointId, operatorId, amount } = params;
  const updated = await tx.abonementWallet.updateMany({
    where: { id: walletId, tenantId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (updated.count === 0) throw new InsufficientBalanceError();

  await tx.abonementTransaction.create({
    data: { walletId, type: "spend", amount, ticketOrderId, pointId, operatorId },
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
