"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/ui/delete-button";
import { IconActionButton } from "@/components/kebab-menu";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Money } from "@/components/money";
import { useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { toDateStr } from "@/lib/datetime-format";
import { cn } from "@/lib/utils";

interface AssetCtx {
  id: string;
  name: string;
}

interface ZoneCtx {
  id: string;
  name: string;
  assets: AssetCtx[];
}

interface OrderTicket {
  id: string;
  assetId: string;
  variantNameSnapshot: string;
  priceSnapshot: number;
  status: string;
  redeemedAt: string | null;
}

interface OrderDetail {
  id: string;
  number: number;
  paymentMethod: string;
  totalSnapshot: number;
  expiresAt: string | null;
  openTicketsCount: number;
  soldAt: string;
  soldByOperatorName: string;
  tickets: OrderTicket[];
}

type VoidTarget = { kind: "ticket"; order: OrderDetail; ticket: OrderTicket } | { kind: "order"; order: OrderDetail };

function isOrderExpired(order: { expiresAt: string | null }, now: Date): boolean {
  return order.expiresAt != null && new Date(order.expiresAt) < now;
}

/**
 * "Экран заказов tickets-зоны" (docs/spec/10-tickets.md, "Кабинет
 * владельца", п.3) — поиск по номеру, список за период, аннулирование
 * поштучно/весь заказ. Только просмотр+аннулирование, никакого гашения —
 * это действие оператора (PWA /operator/tickets), не владельца.
 */
export default function TicketOrdersPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();

  const [zone, setZone] = useState<ZoneCtx | null>(null);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState(() => toDateStr(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateStr(new Date()));
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [searchNumber, setSearchNumber] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<OrderDetail | null>(null);

  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { saved: voidSaved, pulse: voidPulse } = useSavePulse();

  useEffect(() => {
    fetch(`/api/zones/${params.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          router.replace("/points");
          return;
        }
        if (data.accountingMode !== "tickets") {
          router.replace(`/zones/${params.id}`);
          return;
        }
        setZone({ id: data.id, name: data.name, assets: (data.assets ?? []).map((a: AssetCtx) => ({ id: a.id, name: a.name })) });
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function loadOrders() {
    if (!zone) return;
    setOrdersLoading(true);
    fetch(`/api/zones/${zone.id}/ticket-orders?from=${from}&to=${to}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setOrders(data.orders ?? []))
      .finally(() => setOrdersLoading(false));
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (zone) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, from, to]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function searchOrder() {
    if (!zone || !searchNumber) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const res = await fetch(`/api/zones/${zone.id}/ticket-orders?number=${encodeURIComponent(searchNumber)}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? t.tickets.orderNotFound);
        return;
      }
      setSearchResult(data.order);
    } catch {
      setSearchError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSearching(false);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    setError(null);
    try {
      const url =
        voidTarget.kind === "ticket" ? `/api/tickets/${voidTarget.ticket.id}/void` : `/api/ticket-orders/${voidTarget.order.id}/void`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      loadOrders();
      if (searchResult && searchResult.id === voidTarget.order.id) {
        fetch(`/api/zones/${zone!.id}/ticket-orders?number=${searchResult.number}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((d) => d && setSearchResult(d.order));
      }
      voidPulse(() => setVoidTarget(null));
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setVoiding(false);
    }
  }

  if (loading || !zone) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-6 md:max-w-3xl lg:max-w-4xl">
          <div>
            <Link href={`/zones/${zone.id}`} className="mb-2 block w-fit text-body-airbnb font-semibold text-primary">
              ← {zone.name}
            </Link>
            <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.tickets.ownerOrdersTitle}</h1>
          </div>

          <SpringCard hover={false} className="flex flex-col gap-3">
            <div className="flex items-stretch gap-2">
              <Input
                inputMode="numeric"
                value={searchNumber}
                onChange={(e) => setSearchNumber(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && searchOrder()}
                placeholder={t.tickets.searchOrderPlaceholder}
                className="h-11 flex-1 rounded-control bg-muted text-center font-bold tabular-nums"
              />
              <PressableScale>
                <Button type="button" disabled={searching || !searchNumber} onClick={searchOrder} className="h-11 gap-1.5 rounded-control px-4 font-bold">
                  <Search className="size-4.5" />
                  {t.tickets.findOrderButton}
                </Button>
              </PressableScale>
            </div>
            {searchError && <p className="text-sm text-destructive">{searchError}</p>}
            {searchResult && (
              <OwnerOrderCard order={searchResult} zone={zone} locale={locale} t={t} onVoidTicket={(order, ticket) => setVoidTarget({ kind: "ticket", order, ticket })} onVoidOrder={(order) => setVoidTarget({ kind: "order", order })} />
            )}
          </SpringCard>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
            />
            <span className="text-caption-airbnb text-muted-foreground">—</span>
            <input
              type="date"
              value={to}
              min={from}
              max={toDateStr(new Date())}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col gap-3">
            {ordersLoading ? null : orders.length === 0 ? (
              <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.noOrdersYet}</p>
            ) : (
              orders.map((o) => (
                <OwnerOrderCard
                  key={o.id}
                  order={o}
                  zone={zone}
                  locale={locale}
                  t={t}
                  onVoidTicket={(order, ticket) => setVoidTarget({ kind: "ticket", order, ticket })}
                  onVoidOrder={(order) => setVoidTarget({ kind: "order", order })}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <BottomSheet open={voidTarget !== null} onClose={() => setVoidTarget(null)}>
        {voidTarget && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {voidTarget.kind === "ticket" ? t.tickets.voidTicketAction : t.tickets.voidOrderAction}
            </h2>
            <p className="text-body-airbnb">{voidTarget.kind === "ticket" ? t.tickets.confirmVoidTicket : t.tickets.confirmVoidOrder}</p>
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={confirmVoid} deleted={voidSaved} disabled={voiding} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>
    </OwnerShell>
  );
}

function statusLabel(ticket: OrderTicket, order: { expiresAt: string | null }, now: Date, t: ReturnType<typeof useI18n>) {
  if (ticket.status === "voided") return { text: t.tickets.voidedStatusLabel, cls: "text-destructive" };
  if (ticket.status === "redeemed") return { text: t.tickets.redeemedStatusLabel, cls: "text-muted-foreground" };
  if (isOrderExpired(order, now)) return { text: t.tickets.expiredStatusLabel, cls: "text-destructive" };
  return { text: t.tickets.activeStatusLabel, cls: "text-primary" };
}

function OwnerOrderCard({
  order,
  zone,
  locale,
  t,
  onVoidTicket,
  onVoidOrder,
}: {
  order: OrderDetail;
  zone: ZoneCtx;
  locale: string;
  t: ReturnType<typeof useI18n>;
  onVoidTicket: (order: OrderDetail, ticket: OrderTicket) => void;
  onVoidOrder: (order: OrderDetail) => void;
}) {
  const now = new Date();
  const hasVoidableTicket = order.tickets.some((tk) => tk.status === "active");

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[1.0625rem] font-extrabold tabular-nums">
            {t.tickets.orderNumberLabel}
            {order.number}
          </p>
          <p className="text-caption-airbnb text-muted-foreground">
            {new Date(order.soldAt).toLocaleString(locale)} · {t.tickets.soldByLabel} {order.soldByOperatorName}
          </p>
        </div>
        <div className="text-right tabular-nums">
          <Money value={order.totalSnapshot} className="text-lg font-extrabold" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {order.tickets.map((tk) => {
          const st = statusLabel(tk, order, now, t);
          const asset = zone.assets.find((a) => a.id === tk.assetId);
          return (
            <div key={tk.id} className="flex items-center justify-between gap-2 rounded-control bg-muted px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-body-airbnb font-semibold">
                  {asset?.name ?? ""} · {tk.variantNameSnapshot}
                </p>
                <p className={cn("text-caption-airbnb font-semibold", st.cls)}>{st.text}</p>
              </div>
              {tk.status === "active" ? (
                <IconActionButton icon={Trash2} onClick={() => onVoidTicket(order, tk)} label={t.tickets.voidTicketAction} destructive />
              ) : (
                <Money value={tk.priceSnapshot} className="shrink-0 text-caption-airbnb font-semibold text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>
      {hasVoidableTicket && (
        <PressableScale>
          <Button type="button" variant="outline" className="h-9 w-full text-destructive" onClick={() => onVoidOrder(order)}>
            {t.tickets.voidOrderAction}
          </Button>
        </PressableScale>
      )}
    </div>
  );
}
