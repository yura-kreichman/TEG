// Предел неверных ПИН-кодов: 20 за 5 минут (решение владельца 2026-08-08).
//
// Почему счётчик здесь, в памяти, а не в базе, как было раньше. Прежняя
// блокировка (5 попыток → 15 минут, поля PointDevice/User.failedPinAttempts)
// считала попытки БЕЗ окна: счётчик обнулялся только успешным входом на этом же
// устройстве. То есть правило было не «5 неверных подряд», а «5 неверных за всё
// время с последнего удачного входа» — и на устройстве, с которого входят редко,
// они накапливались неделями.
//
// Именно это и произошло 8 августа на тенанте Park (лог nginx): 11:18:21 — один
// неверный ПИН (401), 11:18:23 — уже отказ (429), потому что в базе к тому
// моменту лежало четыре старых промаха. Сотрудник видел блокировку «после двух
// попыток» и был прав.
//
// Окно снимает эту проблему по своей природе: попытки остывают сами, накопиться
// за дни не могут. Цена — счётчик не переживает рестарт контейнера; для
// антибрутфорс-эвристики это приемлемо (тот же принцип и та же оговорка, что у
// auth-rate-limit.ts), а вот тихая блокировка честного сотрудника — нет.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 20;

const failures = new Map<string, number[]>();

let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, timestamps] of failures) {
    const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) failures.delete(key);
    else failures.set(key, fresh);
  }
}

function freshFailures(key: string, now: number): number[] {
  return (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

// Ключ — точка входа, а не человек: операторский ПИН проверяется сканом ВСЕХ
// сотрудников тенанта, при неверном ПИНе неизвестно, чей счётчик увеличивать
// (см. findOperatorByPin в operator-auth.ts). Поэтому считаем по устройству;
// у ПИНа владельца точка входа — его аккаунт.
export function devicePinKey(deviceId: string): string {
  return `device:${deviceId}`;
}

export function userPinKey(userId: string): string {
  return `user:${userId}`;
}

// null — вход разрешён; число — сколько минут ждать.
//
// Ждать нужно не «пока остынут все попытки», а пока их станет меньше предела,
// то есть до истечения (count - MAX + 1)-й по старшинству. Считаем точно:
// обещать больше, чем нужно, — это то же самое, что блокировать дольше нужного.
export function pinBlockedForMinutes(key: string): number | null {
  const now = Date.now();
  sweep(now);

  const timestamps = freshFailures(key, now);
  if (timestamps.length < MAX_FAILED_ATTEMPTS) return null;

  const unblockAt = timestamps[timestamps.length - MAX_FAILED_ATTEMPTS] + WINDOW_MS;

  return Math.max(1, Math.ceil((unblockAt - now) / 60000));
}

export function recordFailedPin(key: string): void {
  const now = Date.now();
  sweep(now);

  const timestamps = freshFailures(key, now);
  timestamps.push(now);
  failures.set(key, timestamps);
}

export function clearFailedPins(key: string): void {
  failures.delete(key);
}
