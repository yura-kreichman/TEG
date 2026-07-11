"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ Safari reports as "Mac" — отличаем от настоящего macOS по
  // наличию touch-точек (у ноутбуков/десктопов их нет).
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
}

/**
 * Принудительный бар установки PWA (по требованию пользователя 2026-07-11):
 * показывается ВЕЗДЕ в приложении, пока оно не установлено — без кнопки
 * закрытия. beforeinstallprompt — не единственный триггер показа (его
 * может не быть ещё какое-то время из-за эвристики вовлечённости Chrome,
 * а на iOS Safari это событие не существует в принципе) — бар виден всегда,
 * когда !isStandalone, кнопка адаптируется под то, что реально доступно.
 */
export default function InstallAppBanner() {
  const t = useI18n();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true); // true до первой проверки — не мигаем баром на SSR/гидрации
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (installed) {
    return null;
  }

  async function handleInstall() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      // Событие одноразовое — использованное больше не вызвать повторно,
      // ждём либо appinstalled, либо браузер когда-нибудь пришлёт новое.
      setDeferredPrompt(null);
      if (outcome === "accepted") setInstalled(true);
      return;
    }
    // Нет захваченного события — либо iOS (там его не бывает вовсе), либо
    // Chrome ещё не решил, что сайт достаточно "вовлекающий". В обоих
    // случаях единственный работающий путь — показать инструкцию вручную.
    setShowIOSHelp(true);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/40 px-4 py-2 text-body-airbnb">
        <span className="text-muted-foreground">{t.install.hint}</span>
        <PressableScale className="shrink-0">
          <Button type="button" size="sm" onClick={handleInstall}>
            {t.install.installButton}
          </Button>
        </PressableScale>
      </div>

      <BottomSheet open={showIOSHelp} onClose={() => setShowIOSHelp(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.install.installButton}</h2>
          <p className="text-body-airbnb text-muted-foreground">
            {isIOS() ? t.install.manualHintIOS : t.install.manualHintOther}
          </p>
          <PressableScale>
            <Button type="button" className="w-full" onClick={() => setShowIOSHelp(false)}>
              {t.common.close}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </>
  );
}
