// Клиентские (без Prisma) чистые хелперы для экрана "Прибывания" в PWA
// оператора — предпросмотр живой суммы/времени. Финальный расчёт при стопе
// всегда на сервере (src/lib/game-room.ts, computeLaunchAmount) — это только
// приблизительное отображение на тайле, пока пуск ещё идёт.

export type LaunchPricingMode = "fixed" | "per_minute";
export type LaunchRoundingMode = "up" | "down" | "nearest";

function roundMinutes(rawMinutes: number, mode: LaunchRoundingMode): number {
  if (mode === "up") return Math.ceil(rawMinutes);
  if (mode === "down") return Math.floor(rawMinutes);
  return Math.round(rawMinutes);
}

// Дублирует roundToWholeCurrencyUnit из src/lib/game-room.ts (серверного,
// с Prisma-импортами) — не импортируем оттуда, чтобы не затянуть серверный
// код в клиентский бандл (см. комментарий вверху файла). Правило то же:
// < половины — вниз, >= половины — вверх.
function roundToWholeCurrencyUnit(amount: number): number {
  const cents = Math.round(amount * 100);
  const wholeUnits = Math.floor(cents / 100);
  const remainderCents = cents - wholeUnits * 100;
  return remainderCents >= 50 ? wholeUnits + 1 : wholeUnits;
}

export function estimateLiveAmount(
  pricingMode: LaunchPricingMode,
  priceSnapshot: number,
  roundingModeSnapshot: LaunchRoundingMode | null,
  minAmountSnapshot: number | null,
  startedAt: Date,
  now: Date,
  // Zone.amountRoundingEnabled (запрос пользователя 2026-07-27) — превью
  // должно показывать ТУ ЖЕ сумму, что реально запишется на стопе, иначе
  // оператор видит одно число здесь и другое после выбора способа оплаты.
  amountRoundingEnabled = false
): number {
  if (pricingMode === "fixed") return priceSnapshot;
  const rawMinutes = Math.max(0, (now.getTime() - startedAt.getTime()) / 60000);
  const minutes = roundMinutes(rawMinutes, roundingModeSnapshot ?? "up");
  const amount = Math.max(minutes * priceSnapshot, minAmountSnapshot ?? 0);
  return amountRoundingEnabled ? roundToWholeCurrencyUnit(amount) : amount;
}

export function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
