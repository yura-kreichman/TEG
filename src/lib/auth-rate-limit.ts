// Rate limit для /api/auth/* (аудит 2026-07-24, реальная дыра — этот префикс
// целиком исключён из мидлвара, src/proxy.ts SUBSCRIPTION_GATE_EXEMPT_PREFIXES,
// и до этого не имел вообще никакой защиты от перебора: ни для пароля
// Owner/Super Admin, ни для рассылки писем сброса пароля). Тот же принцип
// in-memory sliding window по IP, что у src/lib/landing/rate-limit.ts
// (self-hosted, один контейнер, состояние переживает только текущий процесс —
// приемлемо для антибрутфорс-эвристики, не хранилище истины), но со своим,
// куда более узким бюджетом — это не публичный трафик лендинга, а именно
// точки входа в аккаунт. Отдельная Map на каждый вызывающий `purpose`, чтобы
// перебор пароля на /login не делил бюджет с рассылкой писем на /forgot-password.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

// Ввод ПИН-кода — свой, куда более щедрый бюджет. Блокировки аккаунта и
// устройства по неверным ПИНам больше нет (решение владельца 2026-08-08, см.
// login-lockout.ts), и этот лимит остался единственным препятствием перебору.
// Поэтому он подобран так, чтобы человек его не достигал никогда: 120 попыток
// за 5 минут — это 24 в минуту, вчетверо быстрее, чем можно набрать ПИН
// вручную, зато машинному перебору 10000 комбинаций требуются часы, а не
// секунды. Один бюджет на IP, а не на устройство: у точки все планшеты часто
// выходят в сеть через один адрес, и делить его между сотрудниками нельзя.
export const PIN_ATTEMPTS_PER_WINDOW = 120;

const buckets = new Map<string, Map<string, number[]>>();

let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const hits of buckets.values()) {
    for (const [ip, timestamps] of hits) {
      const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
      if (fresh.length === 0) hits.delete(ip);
      else hits.set(ip, fresh);
    }
  }
}

export function isAuthRateLimited(
  purpose: string,
  ip: string,
  maxRequests: number = MAX_REQUESTS_PER_WINDOW
): boolean {
  const now = Date.now();
  sweep(now);

  let hits = buckets.get(purpose);
  if (!hits) {
    hits = new Map();
    buckets.set(purpose, hits);
  }

  const timestamps = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);

  return timestamps.length > maxRequests;
}
