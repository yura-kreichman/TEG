// In-memory sliding window per IP (докс: "Rate limit на публичный роут").
// Не отдельная таблица/Redis — приложение self-hosted в одном Docker-
// контейнере (см. память деплоя), несколько инстансов не разделяют это
// состояние друг с другом, что здесь и не требуется. Переживает только
// текущий процесс — рестарт контейнера тривиально обнуляет счётчики, это
// приемлемо для антиспам-эвристики, не для security-критичного лимита.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

const hits = new Map<string, number[]>();

// Периодическая чистка, чтобы Map не рос бесконечно под трафиком с большим
// разнообразием IP — вызывается изнутри самой проверки, не отдельным таймером.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [ip, timestamps] of hits) {
    const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) hits.delete(ip);
    else hits.set(ip, fresh);
  }
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  sweep(now);

  const timestamps = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);

  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}
