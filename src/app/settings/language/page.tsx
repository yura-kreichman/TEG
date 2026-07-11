"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { LocalePicker } from "@/components/locale-picker";
import { TimezonePicker } from "@/components/timezone-picker";

export default function LanguageSettingsPage() {
  const t = useI18n();

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-caption-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="text-screen-title">{t.settings.languageTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.settings.languageHint}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-2">
                <span className="text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.settings.languageSectionLabel}
                </span>
                <LocalePicker />
              </SpringCard>
            </StaggerItem>
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-2">
                <span className="text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.settings.timezoneTitle}
                </span>
                <TimezonePicker />
                <p className="text-caption-airbnb">{t.settings.timezoneHint}</p>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
