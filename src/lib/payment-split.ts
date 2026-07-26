// Разбивка оплаты одной операции на несколько способов (запрос пользователя
// 2026-07-26: "иногда люди хотят немного наличными, часть безналом и часть с
// баланса") — общая логика для всех модулей, где сейчас один paymentMethod
// на всю сумму (Товары, Билеты, Прибывания/Пуски, Счётчики). Разбивка —
// необязательная: 0 "ног" на стороне БД означает старое поведение без
// единого изменения (тот же приём, что уже применён к TariffOption —
// "По факту" без вариантов работает как раньше).

// Значение paymentMethod на родительской записи, когда используется разбивка
// (вместо одного из обычных cash/mobile/abonement).
export const PAYMENT_SPLIT_METHOD = "split";

export interface PaymentLegInput {
  method: string;
  amount: number;
  walletId?: string;
}

export class InvalidPaymentSplitError extends Error {}

// Проверяет набор "ног" разбивки: минимум 2 (одна нога — это просто обычная
// оплата, разбивка не нужна), метод — из списка допустимых для модуля,
// не больше одной ноги "abonement" (списание — на один конкретный кошелёк,
// spendWalletTx и аналоги принимают ровно один walletId), суммы
// положительные, и сумма всех долей равна итогу (сравнение с округлением до
// копейки — Decimal-суммы в JS через Number подвержены погрешности).
export function validateSplitLegs(
  legs: PaymentLegInput[],
  total: number,
  allowedMethods: readonly string[]
): void {
  if (legs.length < 2) {
    throw new InvalidPaymentSplitError("Разбивка требует минимум 2 способа оплаты");
  }
  let abonementCount = 0;
  let sum = 0;
  for (const leg of legs) {
    if (!allowedMethods.includes(leg.method)) {
      throw new InvalidPaymentSplitError(`Недопустимый способ оплаты: ${leg.method}`);
    }
    if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
      throw new InvalidPaymentSplitError("Сумма доли должна быть положительной");
    }
    if (leg.method === "abonement") {
      abonementCount += 1;
      if (!leg.walletId) {
        throw new InvalidPaymentSplitError("Не выбран кошелёк для доли с оплатой балансом");
      }
    }
    sum += leg.amount;
  }
  if (abonementCount > 1) {
    throw new InvalidPaymentSplitError("Оплата балансом может быть только одной долей");
  }
  // Округление до копейки — сравнение сумм в Decimal через Number.
  if (Math.round((sum - total) * 100) !== 0) {
    throw new InvalidPaymentSplitError("Сумма долей не равна итоговой сумме");
  }
}
