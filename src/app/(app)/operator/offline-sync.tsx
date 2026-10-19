"use client";

import { useEffect, useState } from "react";
import { CloudOff, TriangleAlert } from "lucide-react";
import {
  DROPPED_SUBMISSIONS_EVENT,
  OFFLINE_QUEUE_FLUSHED_EVENT,
  flushPendingSubmissions,
  getPendingSubmissions,
  loadDroppedSubmissions,
  rememberDroppedSubmissions,
  requestPersistentStorage,
  saveDroppedSubmissions,
  type DroppedSubmission,
} from "@/lib/offline-submissions";
import { useI18n } from "@/components/i18n-provider";

/**
 * Фоновая синхронизация офлайн-очереди сдач итогов (src/lib/offline-submissions.ts).
 * Пытается отправить при монтировании (на случай если "online" произошло,
 * пока вкладка/PWA была закрыта) и при каждом событии "online". Работает
 * только пока страница открыта — без Background Sync API (не поддерживается
 * в Safari/iOS вообще, см. обсуждение с пользователем 2026-07-11), поэтому
 * это не гарантия доставки при полностью закрытом приложении, только пока
 * оператор держит PWA открытой/свёрнутой.
 */
export function OfflineSync() {
  const t = useI18n();
  const [pendingCount, setPendingCount] = useState(0);
  // Не автоскрывается само по себе (аудит 2026-07-25, финальный проход) —
  // раньше отклонённая сервером сдача из офлайн-очереди молча удалялась без
  // единого сигнала, вся касса/показания/расходы терялись безвозвратно.
  // Держим список, пока оператор сам не закроет — данные всё равно
  // потеряны, важно, чтобы это заметили и ввели заново вручную. Теперь
  // синхронизирован с localStorage (loadDroppedSubmissions) — переживает
  // перезагрузку/перезапуск PWA, не только текущую вкладку. Перечитывается и
  // по событию: отказы при отправке очереди из "Сменить сотрудника" пишутся
  // туда же.
  const [dropped, setDropped] = useState<DroppedSubmission[]>([]);

  useEffect(() => {
    const reload = () => setDropped(loadDroppedSubmissions());
    reload();
    window.addEventListener(DROPPED_SUBMISSIONS_EVENT, reload);
    return () => window.removeEventListener(DROPPED_SUBMISSIONS_EVENT, reload);
  }, []);

  function dismissDropped() {
    setDropped([]);
    saveDroppedSubmissions([]);
  }

  // Один раз при старте PWA — просим браузер не вычищать нашу IndexedDB сам
  // при нехватке места (см. requestPersistentStorage). Здесь, а не в общем
  // layout: постоянство нужно ровно ради очереди неотправленных сдач, а этот
  // компонент за неё и отвечает. Результат не влияет ни на что — отказ просто
  // оставляет прежнее поведение, поэтому ни state, ни обработки ошибок нет.
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  useEffect(() => {
    async function sync() {
      const result = await flushPendingSubmissions();
      setPendingCount(result.remaining);
      rememberDroppedSubmissions(result.dropped);
    }
    const refreshCount = () => getPendingSubmissions().then((items) => setPendingCount(items.length));
    refreshCount();
    sync();
    window.addEventListener("online", sync);
    window.addEventListener(OFFLINE_QUEUE_FLUSHED_EVENT, refreshCount);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener(OFFLINE_QUEUE_FLUSHED_EVENT, refreshCount);
    };
  }, []);

  return (
    <>
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 bg-warning/15 px-4 py-2 text-caption-airbnb font-semibold text-warning">
          <CloudOff className="size-4 shrink-0" />
          {t.operatorApp.offlineQueueHint.replace("{count}", String(pendingCount))}
        </div>
      )}
      {dropped.length > 0 && (
        <div className="flex items-start gap-2 bg-destructive/15 px-4 py-2 text-caption-airbnb font-semibold text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-1 flex-col gap-1">
            <span>{t.operatorApp.offlineQueueDroppedHint.replace("{count}", String(dropped.length))}</span>
            <button type="button" className="self-start underline" onClick={dismissDropped}>
              {t.common.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
