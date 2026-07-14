"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import QRCode from "qrcode";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { QrCode } from "@/components/qr-code";
import { useI18n } from "@/components/i18n-provider";

// "Показать QR" + поделиться (docs/spec/07-instructions.md — решение
// пользователя 2026-07-12 заменило исходное "печать": на телефоне удобнее
// сразу отправить ссылку в мессенджер, чем печатать). По клику — ОБА
// действия сразу (уточнение пользователя того же дня): ссылка сразу копируется
// в буфер (подстраховка, если человек закроет системное меню "Поделиться" не
// выбрав приложение) И, если браузер поддерживает Web Share, тут же
// открывается системный список приложений; сам QR прикладывается файлом,
// если браузер поддерживает файловый share (progressive enhancement).
export function InstructionQrSheet({
  open,
  onClose,
  title,
  url,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  url: string;
}) {
  const t = useI18n();
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function handleShare() {
    setSharing(true);
    try {
      await navigator.clipboard.writeText(url).catch(() => {});
      setToast(t.instructions.linkCopiedToast);
      setTimeout(() => setToast(null), 1500);

      if (navigator.share) {
        const shareData: ShareData = { title, text: title, url };
        try {
          const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2 });
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], "qr.png", { type: "image/png" });
          if (navigator.canShare?.({ files: [file] })) {
            shareData.files = [file];
          }
        } catch {
          // Без картинки — делимся просто текстом со ссылкой, тоже полноценный share.
        }
        await navigator.share(shareData);
      }
    } catch (err) {
      // Пользователь просто закрыл системное меню "Поделиться" — не ошибка,
      // ссылка уже скопирована в буфер выше.
      if ((err as Error)?.name !== "AbortError") console.error("share failed", err);
    } finally {
      setSharing(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 pt-2 pb-1">
        <h2 className="text-center text-[1.1875rem] font-extrabold tracking-[-0.01em]">{title}</h2>
        <QrCode value={url} alt={title} size={220} />
        <p className="max-w-full break-all text-center text-caption-airbnb">{url}</p>
        <PressableScale className="w-full">
          <Button type="button" variant="outline" className="w-full gap-2" onClick={handleShare} disabled={sharing}>
            <Share2 className="size-4" />
            {t.instructions.shareButton}
          </Button>
        </PressableScale>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-70 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-caption-airbnb font-semibold text-background shadow-lg">
          {toast}
        </div>
      )}
    </BottomSheet>
  );
}
