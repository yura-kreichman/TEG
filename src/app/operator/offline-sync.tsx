"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { flushPendingSubmissions, getPendingSubmissions } from "@/lib/offline-submissions";
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

  useEffect(() => {
    async function sync() {
      const { remaining } = await flushPendingSubmissions();
      setPendingCount(remaining);
    }
    getPendingSubmissions().then((items) => setPendingCount(items.length));
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);

  if (pendingCount === 0) return null;

  return (
    <div className="flex items-center gap-2 bg-warning/15 px-4 py-2 text-caption-airbnb font-semibold text-warning">
      <CloudOff className="size-4 shrink-0" />
      {t.operatorApp.offlineQueueHint.replace("{count}", String(pendingCount))}
    </div>
  );
}
