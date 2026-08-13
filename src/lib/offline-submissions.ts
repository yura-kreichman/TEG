// Офлайн-очередь для мастера сдачи итогов (docs — обсуждение с пользователем
// 2026-07-11): точки на местах, связь может пропадать во время сдачи.
// IndexedDB, не localStorage — payload может быть на пару КБ (несколько зон
// x активов x тарифов), и IndexedDB переживает переполнение квоты storage
// аккуратнее. Только для этого одного write-эндпоинта — офлайн-просмотр
// остальных экранов (деньги/отчёты) сознательно не делаем, устаревшие
// цифры по деньгам, показанные как актуальные, опаснее, чем их отсутствие.

const DB_NAME = "rentos-offline";
const STORE_NAME = "pendingSubmissions";
const DB_VERSION = 1;

/**
 * Просит браузер не вычищать хранилище этого сайта САМ (запрос владельца
 * 2026-08-13). Вызывается один раз при старте PWA оператора.
 *
 * Что это даёт и чего НЕ даёт. По докам MDN (StorageManager.persist),
 * постоянное хранилище означает буквально: «Storage will not be cleared
 * except by explicit user action». То есть защищает ровно от автоматической
 * чистки при нехватке места на устройстве — и не защищает ни от чего,
 * сделанного человеком руками в настройках браузера. Помешать очистке данных
 * сайта нельзя в принципе, иначе любой сайт закреплял бы себя навсегда.
 *
 * Зачем тогда. В этой самой IndexedDB лежит очередь НЕОТПРАВЛЕННЫХ сдач
 * итогов — реальные деньги за смену, которые не ушли на сервер из-за связи.
 * Автоматическая чистка на планшете с забитой памятью стёрла бы их молча.
 * Это единственные данные в приложении, которые существуют ТОЛЬКО на
 * устройстве, поэтому просить постоянство имеет смысл.
 *
 * На привязку устройства это не влияет никак: она живёт в httpOnly-куке, а
 * Storage API куки не покрывает вовсе. Восстановление привязки решается с
 * другой стороны — перевыпуском ссылки активации в кабинете владельца
 * (api/points/[id]/devices/[deviceId]/reissue).
 *
 * Chrome и Safari решают сами по истории взаимодействия с сайтом (у
 * установленного PWA точки шансы высокие), Firefox спрашивает пользователя.
 * Отказ ничего не ломает — поведение остаётся прежним, поэтому результат
 * только логируем и никак на него не реагируем.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    // Сначала спрашиваем текущее состояние: persist() у уже постоянного
    // хранилища безвреден, но лишний вызов в Firefox — это лишний вопрос
    // человеку, который и так однажды ответил.
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface PendingSubmission {
  id: number;
  payload: unknown;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueSubmission(payload: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add({ payload, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getPendingSubmissions(): Promise<PendingSubmission[]> {
  const db = await openDb();
  const result = await new Promise<PendingSubmission[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as PendingSubmission[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function removePendingSubmission(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Пытается отправить все накопленные офлайн-сдачи на сервер. Вызывается при
 * восстановлении связи (событие "online") и при монтировании — на случай,
 * если "online" пропустили (например, вкладка была закрыта, когда связь
 * появилась). Останавливается на первой сетевой ошибке (значит, интернета
 * всё ещё нет по факту, incorrect навигатор.onLine бывает оптимистичным) —
 * не удаляет из очереди то, что не отправилось.
 */
export interface DroppedSubmission {
  createdAt: number;
  error: string;
}

export async function flushPendingSubmissions(): Promise<{
  sent: number;
  remaining: number;
  dropped: DroppedSubmission[];
}> {
  const pending = await getPendingSubmissions();
  let sent = 0;
  // Отклонённые сервером (4xx) сдачи раньше молча удалялись из очереди без
  // единого сигнала оператору (аудит 2026-07-25, финальный проход, реальный
  // найденный баг) — вся сдача (показания/касса/расходы) терялась
  // безвозвратно, владелец узнавал об этом только по факту "почему-то не
  // сошлось", если вообще замечал. Теперь собираем их и возвращаем вызывающему
  // коду (OfflineSync) для видимого, не исчезающего само по себе предупреждения.
  const dropped: DroppedSubmission[] = [];
  for (const item of pending) {
    try {
      const res = await fetch("/api/operator/submit-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      // 401 — не "payload не принят", а истекшая сессия оператора (аудит
      // 2026-07-27, второй раунд, реальная дыра: OPERATOR_SESSION_MAX_AGE
      // всего 12ч — устройство, ушедшее в офлайн на закрытые выходные,
      // возвращается с уже истёкшей сессией; payload при этом полностью
      // валиден и отправился бы успешно, если бы просто подождал повторного
      // входа оператора). Раньше 401 подпадал под "res.status < 500" и
      // удалялся из очереди НАВСЕГДА, как будто это неисправимая ошибка
      // данных — reальная сдача итогов терялась без возможности повтора.
      // Останавливаемся так же, как при сетевой ошибке — оставляем в очереди.
      if (res.status === 401) break;

      // 4xx (кроме 401 выше)/5xx-но-не-от-нас — payload не принят
      // (например, точка/зона уже не существует). Убираем из очереди, чтобы
      // не зациклиться на нём навечно — но не считаем "отправленным".
      if (res.ok || res.status < 500) {
        await removePendingSubmission(item.id);
        if (res.ok) {
          sent++;
        } else {
          const data = await res.json().catch(() => null);
          dropped.push({ createdAt: item.createdAt, error: data?.error ?? `HTTP ${res.status}` });
        }
      }
    } catch {
      // Сетевая ошибка — интернета всё ещё нет, прерываем, оставляя
      // остаток в очереди на следующую попытку.
      break;
    }
  }
  const remaining = (await getPendingSubmissions()).length;
  return { sent, remaining, dropped };
}
