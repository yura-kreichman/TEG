"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { SpringCard } from "@/components/spring-card";
import { cn } from "@/lib/utils";
import { PRICING_URL } from "@/lib/billing";

interface Usage {
  packageName: string;
  subscriptionStatus: "active" | "paused" | "suspended" | "expired";
  subscriptionExpiresAt: string | null;
  currentPeriodEnd: string | null;
  // Ручной оверрайд Super Admin'а (запрос пользователя 2026-07-17) — снимает
  // все 4 лимита разом, значения max/packageMax ниже в этом случае не несут
  // смысла (см. /api/tenant/usage), рендерим "∞" напрямую по этому флагу.
  unlimited: boolean;
  points: { used: number; max: number; packageMax: number };
  operators: { used: number; max: number; packageMax: number };
  zones: { used: number; max: number; packageMax: number };
  assets: { used: number; max: number; packageMax: number };
}

// Перенесено с главной страницы владельца в Настройки, в самый низ (запрос
// пользователя 2026-07-15) — самодостаточный компонент со своей загрузкой
// /api/tenant/usage, раньше это состояние жило в OwnerDashboardCard.
export function PlanCard() {
  const t = useI18n();
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/tenant/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setUsage(data));
  }, []);

  if (!usage) return null;

  const planStatusLabel =
    usage.subscriptionStatus === "paused"
      ? t.home.planStatusPaused
      : usage.subscriptionStatus === "expired"
        ? t.home.planStatusExpired
        : usage.subscriptionStatus === "suspended"
          ? t.home.planStatusSuspended
          : t.home.planStatusActive;

  const planStatusIsWarning =
    usage.subscriptionStatus === "paused" ||
    usage.subscriptionStatus === "expired" ||
    usage.subscriptionStatus === "suspended";

  const planEndDate = usage.subscriptionExpiresAt;

  return (
    <SpringCard hover={false} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-section-title">{t.home.planCardLabel}</p>
          {/* Ручной оверрайд Super Admin'а — название пакета ("Max" и т.п.)
              тут вводит в заблуждение вместе с "2 из 2" ниже (выглядит как
              упор в лимит, хотя лимитов как раз нет — нашёл пользователь
              2026-07-17), поэтому имя плана тоже подменяется на "Безлимит". */}
          <p className="text-card-title">{usage.unlimited ? t.home.unlimitedPlanLabel : usage.packageName}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              planStatusIsWarning ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"
            )}
          >
            <span className={cn("size-1.5 rounded-full", planStatusIsWarning ? "bg-warning" : "bg-primary")} />
            {planStatusLabel}
          </span>
          {planEndDate ? (
            <p className="text-caption-airbnb whitespace-nowrap">
              {t.home.planExpiresPrefix} {new Date(planEndDate).toLocaleDateString()}
            </p>
          ) : (
            usage.currentPeriodEnd &&
            usage.subscriptionStatus === "active" && (
              <p className="text-caption-airbnb whitespace-nowrap text-muted-foreground">
                {t.home.nextBillingPrefix} {new Date(usage.currentPeriodEnd).toLocaleDateString()}
              </p>
            )
          )}
        </div>
      </div>

      {(
        [
          [t.home.limitPoints, usage.points],
          [t.home.limitOperators, usage.operators],
          [t.home.limitZones, usage.zones],
          [t.home.limitAssets, usage.assets],
        ] as const
      ).map(([label, { used, max, packageMax }]) => (
        <div key={label} className="mt-2.5 tabular-nums">
          <div className="mb-1 flex justify-between text-caption-airbnb">
            <span>{label}</span>
            <span className="font-semibold text-foreground">
              {used} {t.common.of}{" "}
              {usage.unlimited ? (
                // Глиф "∞" визуально мельче цифр того же font-size (особенности
                // рисунка символа), поэтому крупнее текста рядом — но text-2xl
                // оказался перегибом в другую сторону (правка пользователя
                // 2026-07-19: "слишком большой... должен быть пропорциональный",
                // после серии 2026-07-17 "слишком мелкий" → "ещё больше") —
                // text-lg держит баланс между этими двумя правками.
                <span className="text-lg font-normal align-middle leading-none">∞</span>
              ) : (
                max
              )}
              {!usage.unlimited && max > packageMax && <span className="text-primary"> (+{max - packageMax})</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-0">
            <div
              className={cn("h-full rounded-full", usage.unlimited ? "bg-muted-foreground/30" : "bg-primary")}
              style={{ width: usage.unlimited ? "100%" : `${Math.min(100, (used / Math.max(max, 1)) * 100)}%` }}
            />
          </div>
        </div>
      ))}

      <a
        href={PRICING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 text-caption-airbnb font-semibold text-primary"
      >
        {t.home.manageSubscriptionLink}
      </a>
    </SpringCard>
  );
}
