"use client";

import { BackLink } from "@/components/back-link";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { AccentPicker } from "@/components/accent-picker";
import { BgStylePicker } from "@/components/bg-style-picker";
import { BgEffectPicker } from "@/components/bg-effect-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { TextSizeSlider } from "@/components/text-size-slider";

export default function AppearanceSettingsPage() {
  const t = useI18n();

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <BackLink label={t.settings.title} href="/settings" className="mb-2" />
          <h1 className="text-screen-title">{t.settings.appearanceTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.settings.appearanceHint}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-2">
                <span className="text-body-airbnb">{t.settings.accentLabel}</span>
                <AccentPicker />
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-2">
                <span className="text-body-airbnb">{t.settings.bgStyleLabel}</span>
                <BgStylePicker />
                {/* Та же плашка, что "Фон приложения" (запрос пользователя
                    2026-07-27) — эффект концептуально часть общего фонового
                    оформления, не отдельная настройка. Начиналось как
                    тумблер "Волны", выросло в выбор одного эффекта из
                    нескольких (BgEffectPicker, Tenant.bgEffect). */}
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  <span className="text-body-airbnb">{t.settings.bgEffectLabel}</span>
                  <BgEffectPicker />
                </div>
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex items-center justify-between">
                <span className="text-body-airbnb">{t.settings.localDeviceThemeLabel}</span>
                <ThemeToggle />
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-2">
                <span className="text-body-airbnb">{t.settings.textSizeLabel}</span>
                <TextSizeSlider />
                <p className="text-caption-airbnb">{t.settings.textSizeHint}</p>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
