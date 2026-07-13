"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { isAndroid, isIOS, isIOSSafari, getAndroidBrowser } from "@/lib/browser-detect";
import type { Dictionary } from "@/lib/i18n";

// Снуз, не полное скрытие (фидбек пользователя 2026-07-12: "добавь крестик
// для скрытия, пусть баннер появляется раз в 2 суток, как напоминание") —
// баннер и раньше был намеренно навязчивым (докс: "принудительный... без
// кнопки закрытия", пользовательское требование от 2026-07-11), это прямое
// смягчение того решения тем же пользователем, не отмена: крестик не
// убирает баннер насовсем, только откладывает на 2 суток.
const DISMISS_KEY = "rentos-install-banner-dismissed-until";
const SNOOZE_MS = 2 * 24 * 60 * 60 * 1000;

function isSnoozed(): boolean {
  const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  return Date.now() < until;
}

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
        // Не свои пошаговые инструкции (manualHintAndroidOpera всё ещё
        // существует в lang/*.json, но больше не используется здесь) — тот же
        // путь, что для неизвестных браузеров: скопировать ссылку и открыть в
        // Chrome. Фидбек пользователя 2026-07-12: "PWA хорошо устанавливается
        // на Xiaomi через Chrome, в Opera не получается" — реальный тест на
        // устройстве важнее предположения Progressify (у них те же шаги меню
        // для Opera, что и мы предлагали раньше), что нативное меню Opera
        // "Домашний экран"/"Установить" создаёт полноценный standalone-PWA —
        // на практике (минимум на Xiaomi/MIUI) это не так.
        return t.install.manualHintAndroidOther;
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
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true); // true до первой проверки — не мигаем баром на SSR/гидрации
  const [showHelp, setShowHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false); // снуз на 2 суток, см. DISMISS_KEY выше

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    setDismissed(isSnoozed());

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

  // Публичная страница инструктажа (docs/spec/07-instructions.md) — читает
  // и подписывает внешний человек, не пользователь RentOS; предлагать ему
  // поставить приложение владельца/оператора неуместно и сбивает с толку.
  if (installed || dismissed || pathname.startsWith("/i/")) {
    return null;
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + SNOOZE_MS));
    setDismissed(true);
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
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-body-airbnb">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t.install.dismiss}
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
        <span className="min-w-0 flex-1 text-muted-foreground">{t.install.hint}</span>
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
