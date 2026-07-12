"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { PRICING_URL } from "@/lib/billing";

/**
 * Баннер неактивной подписки (docs/spec/06-super-admin.md) — рендерится
 * внутри OwnerShell, поэтому виден на каждом экране кабинета владельца, пока
 * subscriptionStatus тенанта expired/suspended. Сама блокировка мутирующих
 * запросов — в src/proxy.ts, этот баннер только информирует; молчит (не
 * рендерит ничего), пока статус не проверен или подписка активна.
 */
export function SubscriptionBanner() {
  const t = useI18n();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && (data.subscriptionStatus === "expired" || data.subscriptionStatus === "suspended")) {
          setBlocked(true);
        }
      });
  }, []);

  if (!blocked) return null;

  return (
    <a
      href={PRICING_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-full items-center justify-center gap-2 bg-warning px-3 py-2 text-center text-caption-airbnb font-semibold text-warning-foreground"
    >
      <CreditCard className="size-4 shrink-0" />
      <span>{t.home.subscriptionBlockedBanner}</span>
      <span className="underline underline-offset-2">{t.home.subscriptionBlockedBannerAction}</span>
    </a>
  );
}
