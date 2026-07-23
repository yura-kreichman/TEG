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
      // 4xx/5xx от сервера — не сетевая проблема, а сам payload не принят
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
