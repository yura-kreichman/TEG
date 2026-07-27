"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";

/**
 * Приветственная шторка при первом входе Владельца (запрос пользователя
 * 2026-07-27) — показывается один раз, пока у тенанта нет ни одной точки
 * (см. серверную проверку в src/app/(app)/page.tsx). Закрытие любым
 * способом (крестик/свайп/кнопка "Начну с нуля") ставит
 * Tenant.onboardingDismissedAt — шторка больше не появляется, повторный
 * вход в неё возможен только вручную создав/удалив всё в самом интерфейсе.
 */
export function OnboardingWelcomeSheet({ initialOpen }: { initialOpen: boolean }) {
  const t = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setOpen(false);
    await fetch("/api/tenant/onboarding/dismiss", { method: "POST" }).catch(() => {});
  }

  async function install() {
    setBusy(true);
    try {
      const res = await fetch("/api/tenant/onboarding/install-demo", { method: "POST" });
      if (!res.ok) return;
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={dismiss}>
      <div className="flex flex-col gap-3 pt-2">
        <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.onboarding.welcomeTitle}</h2>
        <p className="text-body-airbnb text-muted-foreground">{t.onboarding.welcomeBody}</p>
        <PressableScale>
          <Button type="button" className="h-12 w-full font-semibold" disabled={busy} onClick={install}>
            {t.onboarding.installButton}
          </Button>
        </PressableScale>
        <PressableScale>
          <Button type="button" variant="outline" className="h-12 w-full font-semibold" disabled={busy} onClick={dismiss}>
            {t.onboarding.skipButton}
          </Button>
        </PressableScale>
      </div>
    </BottomSheet>
  );
}
