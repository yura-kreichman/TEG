"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

// Тот же принцип, что у футера публичного Лендинга (sections.tsx,
// poweredByPrefix + RentOS365-{light|dark}.svg), но без ссылки на маркетинг-
// сайт — здесь это просто приглушённая подпись внутри кабинета/PWA, не
// кликабельная реклама (запрос пользователя 2026-07-27: "без ссылки НО С
// SVG"). Вариант логотипа — по текущей теме экрана, не по теме тенанта
// (тут нет data.theme лендинга, только next-themes).
export function PoweredByMark({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const t = useI18n();
  // mounted-гейт — та же причина, что у TenantLogoWatermark (реальный баг,
  // запрос пользователя 2026-07-27: "ошибка на странице" была hydration
  // mismatch из-за разного src SVG на сервере/клиенте до гидратации).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const logoVariant = resolvedTheme === "dark" ? "dark" : "light";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground/60", className)}>
      {t.common.poweredByLabel}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/icon-library/pwa/RentOS365-${logoVariant}.svg`} alt="RentOS365" className="h-3.5 w-auto opacity-80" />
    </span>
  );
}
