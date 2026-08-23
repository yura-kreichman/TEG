"use client";

import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { InfoTooltip } from "@/components/info-tooltip";
import { SpringCard } from "@/components/spring-card";
import { Switch } from "@/components/ui/switch";

/**
 * «Доступ техподдержки» — тумблер Владельца под карточкой плана в Настройках
 * (запрос владельца 2026-08-23: вход Super Admin'а в чужой кабинет через
 * Impersonate может нарушать конфиденциальность данных, владелец должен уметь
 * его запретить). По умолчанию доступ ОТКРЫТ — у существующих кабинетов
 * поведение не меняется молча, см. Tenant.supportAccessEnabled.
 *
 * Отдельный компонент, а не строка на экране «Система»: там тумблеры про
 * работу самого кабинета (печать, расходы, модули), а этот — про платформу и
 * её поддержку, поэтому и живёт рядом с планом/подпиской.
 *
 * Из имперсонированной сессии тумблер только показывается, но не
 * переключается (сервер отвечает 403) — иначе запрет снимал бы тот, кого он
 * ограничивает.
 */
export function SupportAccessCard() {
  const t = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [impersonating, setImpersonating] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/system-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setEnabled(data.supportAccessEnabled ?? true));
    fetch("/api/auth/impersonation")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.impersonating && setImpersonating(true));
  }, []);

  if (enabled === null) return null;

  function toggle(value: boolean) {
    setEnabled(value);
    fetch("/api/tenant/system-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supportAccessEnabled: value }),
    }).then((res) => {
      // Откат оптимистичного переключения: единственный отказ здесь —
      // попытка снять запрет из самой имперсонированной сессии.
      if (!res.ok) setEnabled(!value);
    });
  }

  return (
    <SpringCard hover={false} className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LifeBuoy className="size-5" />
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-body-airbnb font-bold">{t.settings.supportAccessLabel}</span>
          <InfoTooltip text={t.settings.supportAccessHint} />
        </div>
      </div>
      <Switch
        checked={enabled}
        disabled={impersonating}
        onCheckedChange={toggle}
        className="shrink-0"
      />
    </SpringCard>
  );
}
