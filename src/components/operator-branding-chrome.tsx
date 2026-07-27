"use client";

import { useEffect, useState } from "react";
import { TenantLogoWatermark } from "@/components/tenant-logo-watermark";
import { PoweredByMark } from "@/components/powered-by-mark";

/**
 * Декоративное фирменное оформление PWA Сотрудника (запрос пользователя
 * 2026-07-27: "логотип компании... декоративный элемент и под паттерном
 * владельца"). Логотип — TenantLogoWatermark, на всех платформах, включая
 * Android (запрос того же дня: "везде с такой 20% видимостью, что-то
 * фоновое"). Подпись "Работает на RentOS" — PoweredByMark, фиксированной
 * плашкой в левом нижнем углу, только md+ (запрос был именно про
 * десктоп/Windows, отдельно от логотипа).
 */
export function OperatorBrandingChrome() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/operator/print-branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setLogoUrl(data?.logoUrl ?? null))
      .catch(() => {});
  }, []);

  return (
    <>
      <TenantLogoWatermark logoUrl={logoUrl} />
      <PoweredByMark className="pointer-events-none fixed bottom-2 right-3 hidden md:inline-flex" />
    </>
  );
}
