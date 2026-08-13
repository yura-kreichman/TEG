// Крошечный кэш в памяти процесса с коротким сроком жизни и явным сбросом
// (аудит производительности 2026-08-13).
//
// Зачем понадобился. Замер на проде: 3,95 млн транзакций к БД при пяти
// тенантах и базе в 15 МБ. Обращений к Tenant — 306 тыс., к Point — 363 тыс.,
// к Operator — 479 тыс. Причина не в тяжёлых запросах, а в их количестве:
// каждый вызов API заново устанавливает контекст. Только isModuleEnabled
// вызывается из 71 файла роутов, и каждый вызов — отдельный SELECT по Tenant
// за пятью булевыми полями, которые меняются раз в месяц.
//
// Почему не React cache(). Доки Next (01-app/02-guides/
// caching-without-cache-components.md) говорят прямо: он дедуплицирует
// «within a single render pass». Роут-хендлеры — не рендер, а именно там
// живут те самые 71 вызов. Проверять это на практике смысла нет: механизм
// заявлен для рендера, полагаться на побочное поведение нельзя.
//
// Почему не unstable_cache. Он про кэш ДАННЫХ между запросами с
// ревалидацией и тегами — здесь достаточно обычной Map, и её поведение
// очевидно при чтении кода.
//
// ЧТО СЮДА КЛАСТЬ МОЖНО, А ЧТО НЕЛЬЗЯ. Только настройки: флаги модулей,
// статус подписки. Личность и права — НИКОГДА: requireOwner/requireOperator
// читают пользователя заново каждый раз, потому что от свежести этого чтения
// зависят деактивация сотрудника, смена роли и отзыв сессий при смене пароля
// (lib/session-revocation.ts). Кэш на секунду там означал бы секунду, в
// которую уволенный сотрудник ещё работает, а отозванная сессия ещё жива.
//
// Срок жизни короткий И есть явный сброс: приложение живёт одним процессом
// (docker-compose.prod.yml), поэтому сброс на записи делает кэш согласованным
// сразу, а TTL остаётся страховкой на случай, если запись прошла мимо
// (миграция, правка в базе руками, второй процесс при будущем масштабировании).
const DEFAULT_TTL_MS = 30_000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const stores = new Map<string, Map<string, Entry<unknown>>>();

function storeFor(namespace: string): Map<string, Entry<unknown>> {
  let store = stores.get(namespace);
  if (!store) {
    store = new Map();
    stores.set(namespace, store);
  }
  return store;
}

/**
 * Возвращает значение из кэша или считает его через load() и запоминает.
 * Параллельные вызовы с одним ключом НЕ дедуплицируются намеренно: гонка тут
 * даёт лишь лишний одинаковый SELECT, а хранение промисов означало бы, что
 * упавший запрос закэширован как отказ.
 */
export async function cached<T>(
  namespace: string,
  key: string,
  load: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const store = storeFor(namespace);
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await load();
  store.set(key, { value, expiresAt: now + ttlMs });

  // Уборка просроченного — по ходу дела, без отдельного таймера: ключей здесь
  // столько же, сколько тенантов, память не растёт.
  if (store.size > 64) {
    for (const [k, e] of store) if (e.expiresAt <= now) store.delete(k);
  }

  return value;
}

/** Сбрасывает запись — вызывается там, где значение меняется. */
export function invalidateCached(namespace: string, key: string): void {
  stores.get(namespace)?.delete(key);
}

/** Сбрасывает пространство имён целиком. */
export function invalidateNamespace(namespace: string): void {
  stores.get(namespace)?.clear();
}
