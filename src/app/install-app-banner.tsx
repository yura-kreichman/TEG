"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { isAndroid, isIOS, isIOSSafari, getAndroidBrowser } from "@/lib/browser-detect";
import type { Dictionary } from "@/lib/i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Точные пошаговые инструкции по браузеру/ОС — подход подсмотрен у
// Progressify (WP-плагин с рабочей PWA-установкой на тех же устройствах,
// где у нас не получалось, см. Progressify/assets/js/installPrompt.js):
// один общий текст "откройте меню браузера" оказался слишком расплывчатым —
// у каждого браузера этот пункт меню называется и расположен по-разному
// (Chrome: "Добавить на гл. экран" в меню ⋮ справа сверху; Samsung Internet:
// пункт "Добавить страницу на" → "Начальный экран"; Edge: "Добавить на
// телефон" в меню ☰ снизу справа и т.д.) — путаница в этом и была причиной
// "что-то добавляется, но криво" (не как полноценный standalone-PWA).
function getManualHint(t: Dictionary): string {
  if (isIOS()) {
    return isIOSSafari() ? t.install.manualHintIOSSafari : t.install.manualHintIOSOther;
  }
  if (isAndroid()) {
    switch (getAndroidBrowser()) {
      case "samsung":
        return t.install.manualHintAndroidSamsung;
      case "opera":
        return t.install.manualHintAndroidOpera;
      case "edge":
        return t.install.manualHintAndroidEdge;
      case "firefox":
        return t.install.manualHintAndroidFirefox;
      case "chrome":
        return t.install.manualHintAndroidChrome;
      default:
        return t.install.manualHintAndroidOther;
    }
  }
  return t.install.manualHintDesktop;
}

/**
 * Принудительный бар установки PWA (по требованию пользователя 2026-07-11):
 * показывается ВЕЗДЕ в приложении, пока оно не установлено — без кнопки
 * закрытия. beforeinstallprompt — не единственный триггер показа (его
 * может не быть ещё какое-то время из-за эвристики вовлечённости Chrome,
 * а на iOS Safari и части Android-браузеров (Samsung Internet, MIUI и
 * т.п.) это событие не срабатывает вовсе) — бар виден всегда, когда
 * !isStandalone, кнопка адаптируется под то, что реально доступно.
 */
export default function InstallAppBanner() {
  const t = useI18n();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true); // true до первой проверки — не мигаем баром на SSR/гидрации
  const [showHelp, setShowHelp] = useState(false);

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
    // Нет захваченного события — либо платформа/браузер его не поддерживает
    // вовсе (iOS, часть Android-браузеров), либо Chrome ещё не решил, что
    // сайт достаточно "вовлекающий". В обоих случаях — точная инструкция
    // под конкретный браузер вместо общей фразы.
    setShowHelp(true);
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

      <BottomSheet open={showHelp} onClose={() => setShowHelp(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.install.installButton}</h2>
          <p className="whitespace-pre-line text-body-airbnb text-muted-foreground">{getManualHint(t)}</p>
          <PressableScale>
            <Button type="button" className="w-full" onClick={() => setShowHelp(false)}>
              {t.common.close}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </>
  );
}
