"use client";

import { useEffect, useState } from "react";
import { CloudOff, TriangleAlert } from "lucide-react";
import { flushPendingSubmissions, getPendingSubmissions, type DroppedSubmission } from "@/lib/offline-submissions";
import { useI18n } from "@/components/i18n-provider";

// Ключ localStorage для "dropped" (аудит 2026-07-27, второй раунд, реальная
// дыра) — раньше это был голый useState([]), ничем не подкреплённый на
// диске: к моменту, когда сдача попадает в "dropped", она УЖЕ удалена из
// IndexedDB-очереди (flushPendingSubmissions это делает сама) — единственная
// оставшаяся запись о том, что данные потеряны, жила только в памяти этой
// вкладки. Перезапуск PWA/питание планшета точки за выходные (тот же
// сценарий, что у самого 401-бага рядом) стирал предупреждение полностью,
// прежде чем кто-то успевал его увидеть — при том, что комментарий ниже
// прямо объявляет целью "не даём случайно потерять из виду".
const DROPPED_STORAGE_KEY = "rentos-offline-dropped-submissions";

function loadStoredDropped(): DroppedSubmission[] {
  try {
    const raw = localStorage.getItem(DROPPED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DroppedSubmission[]) : [];
  } catch {
    return [];
  }
}

function saveStoredDropped(items: DroppedSubmission[]) {
  try {
    localStorage.setItem(DROPPED_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Хранилище недоступно/переполнено — предупреждение всё равно останется
    // видно в текущей сессии через state, просто не переживёт перезагрузку.
  }
}

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
  // синхронизирован с localStorage (DROPPED_STORAGE_KEY выше) — переживает
  // перезагрузку/перезапуск PWA, не только текущую вкладку.
  const [dropped, setDropped] = useState<DroppedSubmission[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setDropped(loadStoredDropped());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function dismissDropped() {
    setDropped([]);
    saveStoredDropped([]);
  }

  useEffect(() => {
    async function sync() {
      const result = await flushPendingSubmissions();
      setPendingCount(result.remaining);
      if (result.dropped.length > 0) {
        setDropped((prev) => {
          const next = [...prev, ...result.dropped];
          saveStoredDropped(next);
          return next;
        });
      }
    }
    getPendingSubmissions().then((items) => setPendingCount(items.length));
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
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
