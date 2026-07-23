import { timingSafeEqual } from "crypto";

// Сравнение секретов вебхуков (Telegram/FluentCart) без тайминг-канала —
// обычное !== сравнивает строки посимвольно и завершается на первом
// несовпадении; timingSafeEqual требует одинаковой длины буферов, поэтому
// длину проверяем отдельно (утечка только длины секрета, не значения — тот
// же приём, что verifyToken/verifyExpiringToken в lib/session-crypto.ts).
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
