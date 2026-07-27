"use client";

import { useEffect, useState } from "react";
import { TenantLogoWatermark } from "@/components/tenant-logo-watermark";
import { PoweredByMark } from "@/components/powered-by-mark";
import { BgEffectLayer, type BgEffect } from "@/components/bg-effects";

/**
 * Декоративное фирменное оформление PWA Сотрудника (запрос пользователя
 * 2026-07-27: "логотип компании... декоративный элемент и под паттерном
 * владельца"). Логотип — TenantLogoWatermark, на всех платформах, включая
 * Android (запрос того же дня: "везде с такой 20% видимостью, что-то
 * фоновое"). Подпись "Работает на RentOS" — PoweredByMark, только md+
 * (запрос был именно про десктоп/Windows, отдельно от логотипа). Фоновый
 * эффект — BgEffectLayer, под нижним баром (запрос того же дня, "давай
 * подумаем" → волны → выбор эффекта), Tenant.bgEffect (Настройки → Внешний
 * вид).
 *
 * bottom — реальный баг, найден пользователем 2026-07-27 (живое фото
 * планшета): нижний бар PWA Сотрудника виден на ЛЮБОЙ ширине экрана
 * (OperatorBottomNav hideOnDesktop={false}, в отличие от owner-shell.tsx,
 * где бар прячется ровно на том же md+, где появляется PoweredByMark, —
 * там коллизии нет). Здесь bottom-2 утыкался прямо под непрозрачный бар и
 * был физически не виден — 4.5rem поднимает плашку выше бара (тот резервирует
 * себе ровно 4rem, см. OperatorBottomNav).
 */
export function OperatorBrandingChrome() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bgEffect, setBgEffect] = useState<BgEffect>("waves");

  useEffect(() => {
    fetch("/api/operator/print-branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setLogoUrl(data?.logoUrl ?? null);
        setBgEffect((data?.bgEffect ?? "waves") as BgEffect);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <TenantLogoWatermark logoUrl={logoUrl} />
      <BgEffectLayer effect={bgEffect} />
      <PoweredByMark className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 hidden md:inline-flex" />
    </>
  );
}
