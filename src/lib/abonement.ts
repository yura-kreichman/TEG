import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sendChatMessage } from "@/lib/telegram-bot";
import { formatMoneyWithCurrency } from "@/lib/format";
import type { CurrencyCode } from "@/lib/currency";
import { BOT_STRINGS, greetingLine } from "@/lib/telegram-client-i18n";
import type { Locale } from "@/lib/locales";
import { PAYMENT_SPLIT_METHOD, validateSplitLegs, type PaymentLegInput } from "@/lib/payment-split";

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

// Длина хвоста-ключа. Восемь — из-за Молдовы (национальный номер
// восьмизначный); подробности у поля AbonementWallet.phoneKey в schema.prisma.
const PHONE_KEY_LENGTH = 8;

/** Ключ сопоставления: последние 8 цифр. Короткий номер даёт сам себя. */
export function phoneMatchKey(raw: string): string {
  const digits = normalizePhone(raw);
  return digits.slice(-PHONE_KEY_LENGTH);
}

/**
 * Строгий признак «это тот же номер, просто записанный короче»: сохранённое
 * (без ведущих нулей — транковый префикс местного набора) целиком является
 * ОКОНЧАНИЕМ проверенного международного номера.
 *
 * Зачем нужен отдельно от совпадения хвоста: у оператора кандидата
 * подтверждает живой человек, а в боте подтверждать некому. Связать чужой
 * кошелёк там — это не дубликат, а показ чужого баланса и возможность им
 * расплатиться, поэтому одного совпадения последних 8 цифр мало.
 *
 * Два РАЗНЫХ настоящих номера так себя не ведут: оба полной длины, с разными
 * кодами стран — ни один не окажется окончанием другого, они разойдутся в
 * середине. А "77795928" и "077795928" — оба окончания "37377795928".
 *
 * Остаточный риск честно есть: короткий "77795928" теоретически является
 * окончанием и российского "79177795928". В пределах одного тенанта это почти
 * исключено (раз номер введён без кода страны, клиентура местная), но нулём
 * назвать нельзя — см. обсуждение 2026-08-12.
 */
export function isSuffixMatch(storedPhone: string, verifiedPhone: string): boolean {
  const stored = normalizePhone(storedPhone).replace(/^0+/, "");
  const verified = normalizePhone(verifiedPhone);
  if (!stored || !verified) return false;
  if (stored === verified) return true;
  return verified.length > stored.length && verified.endsWith(stored);
}

/**
 * Кандидаты по хвосту в пределах тенанта. Именно кандидаты: совпадение хвоста
 * означает «похоже», а не «это он» — решение принимает вызывающая сторона
 * (оператор подтверждает, бот применяет isSuffixMatch выше).
 */
export async function findWalletCandidatesByKey(
  tenantId: string,
  rawPhone: string,
  tx: Tx | typeof prisma = prisma
) {
  const key = phoneMatchKey(rawPhone);
  if (!key) return [];
  return tx.abonementWallet.findMany({ where: { tenantId, phoneKey: key } });
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
export async function notifyWalletBalanceChange(
  tenantId: string,
  walletId: string,
  amount: number,
  detail?: string | null
): Promise<void> {
  const wallet = await prisma.abonementWallet.findUnique({ where: { id: walletId }, select: { name: true, phone: true, balance: true } });
  if (!wallet) return;

  const links = await prisma.clientTelegramLink.findMany({ where: { tenantId, phone: wallet.phone } });
  if (links.length === 0) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, currency: true } });
  if (!tenant) return;

  const currency = tenant.currency as CurrencyCode | null;
  const sign = amount >= 0 ? "+" : "−";

  // Язык — из привязки чата (сохранён один раз при первой проверке контакта,
  // см. вебхук), не из живого Telegram-апдейта: тут его попросту нет, это
  // проактивный пуш, а не ответ на сообщение клиента.
  for (const link of links) {
    const s = BOT_STRINGS[link.language as Locale] ?? BOT_STRINGS.en;
    // Название компании — только если у ЭТОГО чата есть привязка ещё к
    // какому-то другому тенанту (запрос пользователя 2026-07-26: "если у
    // клиента в боте подключено больше одной компании... чтобы было понятно,
    // где списание или пополнение") — не показываем зря там, где клиент и
    // так знает, что это единственный прокат, с которым он взаимодействует.
    const otherLinks = await prisma.clientTelegramLink.findMany({ where: { chatId: link.chatId }, select: { tenantId: true } });
    const isMultiTenant = new Set(otherLinks.map((l) => l.tenantId)).size > 1;
    const text = [
      greetingLine(wallet.name, s),
      ...(isMultiTenant ? [s.companyLine(tenant.name)] : []),
      ...(detail ? [detail] : []),
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
  // Разбивка оплаты (запрос пользователя 2026-07-26) — только cash/mobile
  // (нельзя оплатить пополнение с баланса того же кошелька, по определению).
  // Сумма долей должна равняться plan.price (реальные деньги) — НЕ
  // creditAmount (может включать маркетинговый бонус, который на доли не
  // делится, зачисляется одной суммой независимо от разбивки оплаты).
  legs?: PaymentLegInput[];
  actor: Actor;
}

/**
 * Пополнение существующего кошелька — планом владельца (запрос пользователя
 * 2026-07-17: "фиксированные пакеты"), сумма зачисления берётся из
 * Abonement.creditAmount, а не price (бонус). Атомарно: баланс + журнал
 * кошелька + денежный след кассы точки одной транзакцией.
 */
export async function topUpWallet(walletId: string, params: TopupParams) {
  const { tenantId, pointId, abonementId, paymentMethod, legs, actor } = params;
  const { wallet, creditAmount } = await prisma.$transaction(async (tx) => {
    const plan = await tx.abonement.findFirst({
      where: { id: abonementId, tenantId, deletedAt: null },
    });
    if (!plan) throw new Error("ABONEMENT_NOT_FOUND");
    if (legs && legs.length > 0) validateSplitLegs(legs, Number(plan.price), ABONEMENT_TOPUP_PAYMENT_METHODS);

    // updateMany с tenantId в where, не голый update (аудит 2026-07-25,
    // финальный проход) — defense-in-depth, тот же приём, что уже
    // используют все money-OUT функции этого файла (spendWalletTx и
    // соседи); сегодня все вызывающие роуты и так проверяют владение
    // кошельком заранее, но здесь эта проверка встроена в саму операцию, а
    // не оставлена только на совести вызывающего кода.
    const claimed = await tx.abonementWallet.updateMany({
      where: { id: walletId, tenantId },
      data: { balance: { increment: plan.creditAmount } },
    });
    if (claimed.count === 0) throw new Error("WALLET_NOT_FOUND");
    const wallet = await tx.abonementWallet.findUniqueOrThrow({ where: { id: walletId } });

    await tx.abonementTransaction.create({
      data: {
        walletId,
        type: "topup",
        amount: plan.creditAmount,
        abonementId: plan.id,
        paymentMethod: legs && legs.length > 0 ? PAYMENT_SPLIT_METHOD : paymentMethod,
        pointId,
        operatorId: actor.operatorId,
        userId: actor.userId,
      },
    });

    if (legs && legs.length > 0) {
      for (const leg of legs) {
        await tx.moneyOperation.create({
          data: {
            tenantId,
            pointId,
            abonementId: plan.id,
            type: abonementTopupMoneyType(leg.method as AbonementTopupPaymentMethod),
            amount: leg.amount,
            performedByOperatorId: actor.operatorId,
            performedByUserId: actor.userId,
          },
        });
      }
    } else {
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
    }

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
  // Разбивка оплаты (запрос пользователя 2026-07-26) — только cash/mobile,
  // сумма долей должна равняться amount (здесь нет отдельного бонуса —
  // сумма оплаты всегда равна сумме зачисления).
  legs?: PaymentLegInput[];
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
  const { tenantId, pointId, amount, paymentMethod, legs, actor } = params;
  if (legs && legs.length > 0) validateSplitLegs(legs, amount, ABONEMENT_TOPUP_PAYMENT_METHODS);
  const wallet = await prisma.$transaction(async (tx) => {
    // updateMany с tenantId — см. комментарий в topUpWallet выше.
    const claimed = await tx.abonementWallet.updateMany({
      where: { id: walletId, tenantId },
      data: { balance: { increment: amount } },
    });
    if (claimed.count === 0) throw new Error("WALLET_NOT_FOUND");
    const wallet = await tx.abonementWallet.findUniqueOrThrow({ where: { id: walletId } });

    await tx.abonementTransaction.create({
      data: {
        walletId,
        type: "topup",
        amount,
        paymentMethod: legs && legs.length > 0 ? PAYMENT_SPLIT_METHOD : paymentMethod,
        pointId,
        operatorId: actor.operatorId,
        userId: actor.userId,
      },
    });

    if (legs && legs.length > 0) {
      for (const leg of legs) {
        await tx.moneyOperation.create({
          data: {
            tenantId,
            pointId,
            type: abonementTopupMoneyType(leg.method as AbonementTopupPaymentMethod),
            amount: leg.amount,
            performedByOperatorId: actor.operatorId,
            performedByUserId: actor.userId,
          },
        });
      }
    } else {
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
    }

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
  const { tenantId, pointId, amount, paymentMethod, legs, actor } = params;
  if (legs && legs.length > 0) validateSplitLegs(legs, amount, ABONEMENT_TOPUP_PAYMENT_METHODS);

  const wallet = await prisma.$transaction(async (tx) => {
    const wallet = await tx.abonementWallet.create({
      data: { tenantId, phone, phoneKey: phoneMatchKey(phone), name: name || null, balance: amount },
    });

    await tx.abonementTransaction.create({
      data: {
        walletId: wallet.id,
        type: "topup",
        amount,
        paymentMethod: legs && legs.length > 0 ? PAYMENT_SPLIT_METHOD : paymentMethod,
        pointId,
        operatorId: actor.operatorId,
        userId: actor.userId,
      },
    });

    if (legs && legs.length > 0) {
      for (const leg of legs) {
        await tx.moneyOperation.create({
          data: {
            tenantId,
            pointId,
            type: abonementTopupMoneyType(leg.method as AbonementTopupPaymentMethod),
            amount: leg.amount,
            performedByOperatorId: actor.operatorId,
            performedByUserId: actor.userId,
          },
        });
      }
    } else {
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
    }

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
  return prisma.abonementWallet.create({
    data: { tenantId, phone, phoneKey: phoneMatchKey(phone), name: name || null, balance: 0 },
  });
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
  const { tenantId, pointId, abonementId, paymentMethod, legs, actor } = params;

  const wallet = await prisma.$transaction(async (tx) => {
    const plan = await tx.abonement.findFirst({
      where: { id: abonementId, tenantId, deletedAt: null },
    });
    if (!plan) throw new Error("ABONEMENT_NOT_FOUND");
    if (legs && legs.length > 0) validateSplitLegs(legs, Number(plan.price), ABONEMENT_TOPUP_PAYMENT_METHODS);

    const wallet = await tx.abonementWallet.create({
      data: { tenantId, phone, phoneKey: phoneMatchKey(phone), name: name || null, balance: plan.creditAmount },
    });

    await tx.abonementTransaction.create({
      data: {
        walletId: wallet.id,
        type: "topup",
        amount: plan.creditAmount,
        abonementId: plan.id,
        paymentMethod: legs && legs.length > 0 ? PAYMENT_SPLIT_METHOD : paymentMethod,
        pointId,
        operatorId: actor.operatorId,
        userId: actor.userId,
      },
    });

    if (legs && legs.length > 0) {
      for (const leg of legs) {
        await tx.moneyOperation.create({
          data: {
            tenantId,
            pointId,
            abonementId: plan.id,
            type: abonementTopupMoneyType(leg.method as AbonementTopupPaymentMethod),
            amount: leg.amount,
            performedByOperatorId: actor.operatorId,
            performedByUserId: actor.userId,
          },
        });
      }
    } else {
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
    }

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
export async function adjustWalletBalance(walletId: string, tenantId: string, amount: number, userId: string) {
  const wallet = await prisma.$transaction(async (tx) => {
    // updateMany с tenantId — см. комментарий в topUpWallet выше.
    const claimed = await tx.abonementWallet.updateMany({
      where: { id: walletId, tenantId },
      data: { balance: { increment: amount } },
    });
    if (claimed.count === 0) throw new Error("WALLET_NOT_FOUND");
    const wallet = await tx.abonementWallet.findUniqueOrThrow({ where: { id: walletId } });

    await tx.abonementTransaction.create({
      data: { walletId, type: "adjustment", amount, userId },
    });

    return wallet;
  });

  await notifyWalletBalanceChange(tenantId, walletId, amount).catch(() => {});
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
      data: { tenantId, phone, phoneKey: phoneMatchKey(phone), name: name || null, balance: amount },
    });

    await tx.abonementTransaction.create({
      data: { walletId: wallet.id, type: "adjustment", amount, userId },
    });

    return wallet;
  });

  await notifyWalletBalanceChange(tenantId, wallet.id, amount).catch(() => {});
  return wallet;
}

/**
 * "За что" списание/возврат — иначе выписка/история показывали безликое
 * "Списание" без единого пояснения (запрос пользователя 2026-07-24: "лучше,
 * чтобы не было написано просто Списание, а за что именно — Товары, зоны,
 * активы и т.д."). Порядок проверки соответствует набору взаимоисключающих
 * ссылок AbonementTransaction — ровно одна заполнена на транзакцию. Общий
 * хелпер для обоих мест, что читают историю (operator/abonements,
 * abonement-wallets/[id]) — include-форма join'ов там должна совпадать с
 * тем, что здесь ожидается.
 */
export function describeAbonementTransactionSource(h: {
  launch?: { zone: { name: string } } | null;
  goodsSale?: { goods: { name: string } } | null;
  ticketOrder?: { zone: { name: string } } | null;
  tariff?: { zone: { name: string } } | null;
}): string | null {
  return h.launch?.zone.name ?? h.goodsSale?.goods.name ?? h.ticketOrder?.zone.name ?? h.tariff?.zone.name ?? null;
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("INSUFFICIENT_BALANCE");
  }
}

// Ровно один вариант: "Счётчики" — оплата привязана к зоне+тарифам, без
// актива (запрос пользователя 2026-07-24: на экране "Списать с баланса"
// выбор конкретного актива — чистое трение без пользы для денег зоны, сумма
// зависит только от тарифа, актив раньше давал только подпись в истории
// кошелька), НЕСКОЛЬКО строк за раз (запрос того же дня: "чтобы Сотрудник
// мог списывать сразу несколько тарифов", степпер количества — та же
// механика, что уже есть у Билетов); "Только касса" — у зоны вообще нет
// активов/тарифов (docs/spec/01-counters.md), привязывать оплату не к чему,
// только к самой зоне, свободная сумма остаётся одной строкой.
type ZoneSpendTarget =
  | { kind: "counterTariff"; zoneId: string; lines: { tariffId: string; quantity: number }[] }
  | { kind: "cashOnlyZone"; zoneId: string; amount: number };

interface ZoneSpendParams {
  tenantId: string;
  pointId: string;
  operatorId: string;
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
 *
 * "Счётчики" — сумма КАЖДОЙ строки считается СЕРВЕРОМ от реальной цены
 * тарифа (не доверяем amount от клиента, запрос пользователя 2026-07-24
 * закрыл заодно и небольшую дыру доверия, которая была раньше) — на каждый
 * выбранный тариф своя AbonementTransaction (аудит по тарифам остаётся
 * читаемым, тот же приём, что у отдельных строк GoodsSale/Ticket за один
 * чек), но ОДНА общая MoneyOperation на всю корзину — MoneyOperation не
 * хранит tariffId, разбивка по тарифам ей не нужна.
 */
export async function spendWalletForZone(walletId: string, params: ZoneSpendParams) {
  const { tenantId, pointId, operatorId, target } = params;

  return prisma.$transaction(async (tx) => {
    let zoneId: string;
    let zoneName: string;
    let totalAmount = 0;
    const txLines: { tariffId: string | null; amount: number; quantity: number | null }[] = [];

    if (target.kind === "counterTariff") {
      if (target.lines.length === 0) throw new Error("EMPTY_CART");
      const zone = await tx.zone.findFirst({
        where: { id: target.zoneId, pointId, point: { tenantId }, accountingMode: "counters" },
        select: { id: true, name: true },
      });
      if (!zone) throw new Error("ZONE_NOT_FOUND");
      zoneId = zone.id;
      zoneName = zone.name;
      for (const line of target.lines) {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
        const tariff = await tx.tariff.findFirst({ where: { id: line.tariffId, zoneId: zone.id, deletedAt: null } });
        if (!tariff) throw new Error("TARIFF_NOT_FOUND");
        const amount = Math.round(Number(tariff.price) * line.quantity * 100) / 100;
        totalAmount += amount;
        txLines.push({ tariffId: line.tariffId, amount, quantity: line.quantity });
      }
      if (txLines.length === 0) throw new Error("EMPTY_CART");
    } else {
      const zone = await tx.zone.findFirst({
        where: { id: target.zoneId, pointId, point: { tenantId }, accountingMode: "cash_only" },
        select: { id: true, name: true },
      });
      if (!zone) throw new Error("ZONE_NOT_FOUND");
      zoneId = zone.id;
      zoneName = zone.name;
      totalAmount = target.amount;
      txLines.push({ tariffId: null, amount: target.amount, quantity: null });
    }

    const updated = await tx.abonementWallet.updateMany({
      where: { id: walletId, tenantId, balance: { gte: totalAmount } },
      data: { balance: { decrement: totalAmount } },
    });
    if (updated.count === 0) throw new InsufficientBalanceError();

    // assetId больше не проставляется (запрос пользователя 2026-07-24) —
    // поле осталось nullable в схеме ради старых записей. quantity — только
    // у "Счётчиков"-строк (запрос того же дня: "в Печатную сводку и везде
    // должно быть указано количество").
    for (const line of txLines) {
      await tx.abonementTransaction.create({
        data: { walletId, type: "spend", amount: line.amount, tariffId: line.tariffId, quantity: line.quantity, pointId, operatorId },
      });
    }

    await tx.moneyOperation.create({
      data: { tenantId, zoneId, type: "revenue_abonement", amount: totalAmount, performedByOperatorId: operatorId },
    });

    return { wallet: await tx.abonementWallet.findUniqueOrThrow({ where: { id: walletId } }), totalAmount, zoneName, txLines };
  }).then(async ({ wallet, totalAmount, zoneName, txLines }) => {
    // Количество показываем в пуше только когда строка одна (запрос
    // пользователя 2026-07-24, тот же формат, что historyLabel() в
    // abonement-topup-flow.tsx) — при нескольких тарифах в одной корзине
    // единое "× N" было бы неоднозначным (к какому тарифу относится).
    const single = txLines.length === 1 ? txLines[0] : null;
    const detail = single?.quantity ? `${zoneName} × ${single.quantity}` : zoneName;
    await notifyWalletBalanceChange(tenantId, walletId, -totalAmount, detail).catch(() => {});
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
export async function getZoneAbonementSpendAmount(
  zoneId: string,
  since: Date | null,
  tx: Tx | typeof prisma = prisma
): Promise<number> {
  const ops = await tx.moneyOperation.findMany({
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
