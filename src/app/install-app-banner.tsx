"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "teg:installBannerDismissed";

export default function InstallAppBanner() {
  const t = useI18n();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [dismissed, setDismissed] = useState(false);

  // One-time sync from browser-only APIs on mount; must run post-hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone || window.sessionStorage.getItem(DISMISSED_KEY)) {
      setDismissed(true);
    }

    // Без зарегистрированного service worker Chrome вообще не считает
    // сайт устанавливаемым и никогда не шлёт beforeinstallprompt — баннер
    // ниже был мёртвым кодом без этого (см. public/sw.js).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (dismissed || !deferredPrompt) {
    return null;
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Chrome only allows a captured prompt event to be used once.
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/40 px-4 py-2 text-body-airbnb">
      <span className="text-muted-foreground">{t.install.hint}</span>
      <div className="flex shrink-0 items-center gap-3">
        <PressableScale>
          <Button type="button" size="sm" onClick={handleInstall}>
            {t.install.installButton}
          </Button>
        </PressableScale>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t.install.dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
