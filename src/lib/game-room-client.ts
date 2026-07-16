// Клиентские (без Prisma) чистые хелперы для экрана "Игровой комнаты" в PWA
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

export function estimateLiveAmount(
  pricingMode: LaunchPricingMode,
  priceSnapshot: number,
  roundingModeSnapshot: LaunchRoundingMode | null,
  minAmountSnapshot: number | null,
  startedAt: Date,
  now: Date
): number {
  if (pricingMode === "fixed") return priceSnapshot;
  const rawMinutes = Math.max(0, (now.getTime() - startedAt.getTime()) / 60000);
  const minutes = roundMinutes(rawMinutes, roundingModeSnapshot ?? "nearest");
  const amount = minutes * priceSnapshot;
  return Math.max(amount, minAmountSnapshot ?? 0);
}

export function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
