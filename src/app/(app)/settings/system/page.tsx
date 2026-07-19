"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";

interface SystemSettings {
  goodsAllowBalancePayment: boolean;
}

const DEFAULTS: SystemSettings = { goodsAllowBalancePayment: true };

/**
 * Настройки → Система (запрос пользователя 2026-07-20) — глобальные
 * тумблеры Владельца, не привязанные к конкретному модулю по месту в меню.
 * Первый пункт — разрешена ли клиентам оплата Товаров балансом абонемента
 * (docs/spec/09-goods.md, "Продажа" — до этого баланс был безусловным
 * способом оплаты). Задумана расширяемой — новые тумблеры добавляются в
 * rows ниже, без переделки страницы.
 */
export default function SystemSettingsPage() {
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULTS);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/tenant/system-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSettings((prev) => ({ ...prev, ...data }));
        setChecking(false);
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function patch(partial: Partial<SystemSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    fetch("/api/tenant/system-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  const rows: Array<{ key: keyof SystemSettings; label: string; sub: string }> = [
    {
      key: "goodsAllowBalancePayment",
      label: t.settings.systemGoodsBalancePaymentLabel,
      sub: t.settings.systemGoodsBalancePaymentHint,
    },
  ];

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="mb-4 text-screen-title">{t.settings.systemTitle}</h1>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
                    <div className="min-w-0">
                      <div className="text-body-airbnb">{row.label}</div>
                      <div className="text-caption-airbnb">{row.sub}</div>
                    </div>
                    <Switch checked={settings[row.key]} onCheckedChange={(v) => patch({ [row.key]: v })} className="shrink-0" />
                  </div>
                ))}
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
