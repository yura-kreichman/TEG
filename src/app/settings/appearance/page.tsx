"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { AccentPicker } from "@/components/accent-picker";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppearanceSettingsPage() {
  const t = useI18n();

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-caption-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="text-screen-title">{t.settings.appearanceTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.settings.appearanceHint}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-body-airbnb">{t.settings.accentLabel}</span>
                  <AccentPicker />
                </div>
                <div className="flex items-center justify-between rounded-control bg-muted/40 p-3">
                  <span className="text-body-airbnb">{t.settings.localDeviceThemeLabel}</span>
                  <ThemeToggle />
                </div>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
