"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { useI18n, useLocale } from "@/components/i18n-provider";
import { pricingUrl } from "@/lib/billing";
import { cn } from "@/lib/utils";

/**
 * Баннер неактивной подписки (docs/spec/06-super-admin.md) — рендерится
 * внутри OwnerShell, поэтому виден на каждом экране кабинета владельца, пока
 * subscriptionStatus тенанта expired/suspended. Сама блокировка мутирующих
 * запросов — в src/proxy.ts, этот баннер только информирует; молчит (не
 * рендерит ничего), пока статус не проверен или подписка активна.
 */
export function SubscriptionBanner() {
  const t = useI18n();
  const locale = useLocale();
  const [blocked, setBlocked] = useState(false);
  // Дата автоудаления кабинета — приходит, только когда владельцу уже ушло
  // финальное письмо (см. /api/tenant/usage). Отдельно от blocked: удаление
  // сообщение более срочное и перебивает обычное "подписка неактивна".
  const [deletionAt, setDeletionAt] = useState<string | null>(null);
  // Подписанный идентификатор кабинета для ссылки на оплату: у баннера это
  // особенно важно — по нему уходит платить владелец с УЖЕ истёкшей подпиской,
  // то есть ровно тот, у кого в кабинете накоплены данные и кому второй, пустой
  // кабинет от оплаты с чужого адреса навредил бы сильнее всего.
  const [billingToken, setBillingToken] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tenant/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.subscriptionStatus === "expired" || data.subscriptionStatus === "suspended") {
          setBlocked(true);
        }
        if (typeof data.deletionScheduledAt === "string") {
          setDeletionAt(data.deletionScheduledAt);
        }
        if (typeof data.billingToken === "string") {
          setBillingToken(data.billingToken);
        }
      });
  }, []);

  if (!blocked && !deletionAt) return null;

  const isDeletion = deletionAt !== null;
  const label = isDeletion
    ? t.home.deletionBanner.replace("{date}", new Date(deletionAt).toLocaleDateString(locale))
    : t.home.subscriptionBlockedBanner;
  const action = isDeletion ? t.home.deletionBannerAction : t.home.subscriptionBlockedBannerAction;

  return (
    <a
      href={pricingUrl(locale, billingToken)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex w-full items-center justify-center gap-2 px-3 py-2 text-center text-caption-airbnb font-semibold",
        // Скорое безвозвратное удаление — единственное состояние подписки,
        // которое опаснее "истекла": предупреждающий жёлтый здесь потерялся бы
        // рядом с ним же на неактивной подписке.
        // text-white, а не парный токен: у destructive его в палитре нет
        // (в отличие от warning), и в проекте на этом фоне везде белый текст.
        isDeletion ? "bg-destructive text-white" : "bg-warning text-warning-foreground"
      )}
    >
      <CreditCard className="size-4 shrink-0" />
      <span>{label}</span>
      <span className="underline underline-offset-2">{action}</span>
    </a>
  );
}
