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

export function isAuthRateLimited(purpose: string, ip: string): boolean {
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

  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}
