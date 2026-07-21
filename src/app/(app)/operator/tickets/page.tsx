"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, CreditCard, Delete, Layers, MapPin, Minus, Plus, Printer, Search, Ticket, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { openPrintDocument, type PrintDocumentData } from "@/lib/print/receipt-document";
import { isTicketsZone } from "@/lib/results-calc";
import { formatMoneyWithCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TicketVariantCtx {
  id: string;
  name: string;
  price: number;
}

interface AssetCtx {
  id: string;
  name: string;
  iconKey: string | null;
  photoUrl: string | null;
  colorTag: string;
  active: boolean;
  ticketVariants: TicketVariantCtx[];
}

interface ZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  assets: AssetCtx[];
  ticketRedemptionEnabled: boolean;
}

// cart key: `${assetId}:${variantId}`
type Cart = Record<string, number>;

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

type Tab = "sell" | "orders";

// "Я стою на Карусели" (docs/spec/10-tickets.md, "PWA оператора") — личная
// настройка вкладки «Заказы», переживает перезагрузку страницы (та же
// логика, что ZONE_FILTER_KEY в game-room.tsx).
const ASSET_FILTER_KEY = "ticketsAssetFilter";
const ALL_ASSETS = "all";

function isOrderExpired(order: { expiresAt: string | null }, now: Date): boolean {
  return order.expiresAt != null && new Date(order.expiresAt) < now;
}

/**
 * Экран "Билеты" в PWA оператора (docs/spec/10-tickets.md) — вход из
 * нижнего бара напрямую сюда (тот же принцип, что "Прибывания"/"Пуски"),
 * без промежуточного списка зон. Две вкладки: "Продать" (доступна только с
 * тумблером Оператора ticketsAccess — серверная проверка ещё и в
 * /api/zones/[id]/ticket-orders POST) и "Заказы" (поиск по номеру + гашение,
 * доступна ЛЮБОМУ оператору с доступом к зоне, без тумблера — докс:
 * "оператор без тумблера всё ещё гасит билеты").
 */
export default function TicketsZonePage() {
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const printAvailable = useOperatorPrintAvailable();

  const [zones, setZones] = useState<ZoneCtx[]>([]);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [ticketsAccess, setTicketsAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("sell");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          router.replace("/operator/login");
          return;
        }
        const tickets: ZoneCtx[] = (data.zones ?? [])
          .filter(isTicketsZone)
          .map(
            (z: {
              id: string;
              name: string;
              iconKey: string | null;
              assets: AssetCtx[];
              ticketRedemptionEnabled: boolean;
            }) => ({
              id: z.id,
              name: z.name,
              iconKey: z.iconKey,
              assets: z.assets ?? [],
              ticketRedemptionEnabled: z.ticketRedemptionEnabled,
            })
          );
        if (tickets.length === 0) {
          router.replace("/operator");
          return;
        }
        setZones(tickets);
        setZoneId((prev) => prev ?? tickets[0]?.id ?? null);
        setTicketsAccess(Boolean(data.ticketsAccess));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zone = zones.find((z) => z.id === zoneId) ?? null;

  // ---- Продать ----
  const [cart, setCart] = useState<Cart>({});
  const [variantSheetAssetId, setVariantSheetAssetId] = useState<string | null>(null);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [abonementTarget, setAbonementTarget] = useState<{ amount: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState<{
    zoneName: string;
    number: number;
    totalSnapshot: number;
    expiresAt: string | null;
    soldAt: string;
    paymentMethod: string;
    tickets: { id: string; assetName: string; variantName: string; price: number }[];
  } | null>(null);
  // Печать всех билетов заказа — ОДНА кнопка "Распечатать билеты"
  // (docs/spec/10-tickets.md, "PWA оператора"), которая внутри делает N
  // ПОСЛЕДОВАТЕЛЬНЫХ вызовов печати, по одному документу на билет (докс,
  // "ПЕЧАТЬ": решение пользователя 2026-07-21 — один документ с разрывами
  // страниц отклонён, на Bluetooth ESC/POS давал испорченную "страницу";
  // N отдельных вызовов подряд, с паузой между ними — тот же кулдаун, что у
  // общего PrintButton, только автоматический, не по N ручным тапам).
  const [printingIndex, setPrintingIndex] = useState<number | null>(null);

  function selectZone(id: string) {
    setZoneId(id);
    setCart({});
    setSearchResult(null);
    setSearchNumber("");
  }

  function cartKey(assetId: string, variantId: string) {
    return `${assetId}:${variantId}`;
  }

  function cartLines(z: ZoneCtx) {
    const lines: { assetId: string; assetName: string; variantId: string; variantName: string; price: number; quantity: number }[] =
      [];
    for (const [key, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      const [assetId, variantId] = key.split(":");
      const asset = z.assets.find((a) => a.id === assetId);
      const variant = asset?.ticketVariants.find((v) => v.id === variantId);
      if (!asset || !variant) continue;
      lines.push({ assetId, assetName: asset.name, variantId, variantName: variant.name, price: variant.price, quantity });
    }
    return lines;
  }

  const currentCartLines = zone ? cartLines(zone) : [];
  const cartTicketsCount = currentCartLines.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = currentCartLines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  function setQuantity(assetId: string, variantId: string, quantity: number) {
    setCart((prev) => ({ ...prev, [cartKey(assetId, variantId)]: Math.max(0, quantity) }));
  }

  const variantSheetAsset = zone?.assets.find((a) => a.id === variantSheetAssetId) ?? null;

  async function submitOrder(paymentMethod: "cash" | "mobile" | "abonement", abonementWalletId?: string) {
    if (!zone || currentCartLines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/zones/${zone.id}/ticket-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: currentCartLines.map((l) => ({ assetId: l.assetId, variantId: l.variantId, quantity: l.quantity })),
          paymentMethod,
          abonementWalletId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      // Одна строка корзины -> N билетов одного варианта — снапшот тикетов
      // для success-экрана строится тут же, id самих Ticket сервер не
      // возвращает по одному (только агрегат) — печати нужен только текст,
      // не реальный Ticket.id, поэтому синтетический ключ вполне достаточен.
      const ticketRows: { id: string; assetName: string; variantName: string; price: number }[] = [];
      for (const l of currentCartLines) {
        for (let i = 0; i < l.quantity; i++) {
          ticketRows.push({ id: `${l.variantId}-${i}`, assetName: l.assetName, variantName: l.variantName, price: l.price });
        }
      }
      setLastOrder({
        zoneName: zone.name,
        number: data.number,
        totalSnapshot: data.totalSnapshot,
        expiresAt: data.expiresAt,
        soldAt: data.soldAt,
        paymentMethod,
        tickets: ticketRows,
      });
      setCart({});
      setCartSheetOpen(false);
      setPaymentOpen(false);
      setAbonementTarget(null);
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  const paymentMethodLabel: Record<string, string> = {
    cash: t.operatorApp.submit.cashLabel,
    mobile: t.operatorApp.submit.mobileLabel,
    abonement: t.reports.abonementLabel,
  };

  function buildTicketReceiptData(
    ticket: { assetName: string; variantName: string; price: number },
    order: { zoneName: string; number: number; expiresAt: string | null; soldAt: string; paymentMethod: string }
  ): PrintDocumentData {
    return {
      title: t.tickets.receiptTitle,
      // Дата ПРОДАЖИ (docs/spec/10-tickets.md, "ПЕЧАТЬ": "дата продажи"), не
      // момент печати — реальный баг: при допечатке потерянного билета из
      // вкладки «Заказы» (см. printOrderTickets) новая печать могла случиться
      // в любой день после продажи, new Date() показывал бы неверную дату.
      subtitle: `${order.zoneName} · ${new Date(order.soldAt).toLocaleString(locale)}${printAvailable.operatorName ? ` · ${printAvailable.operatorName}` : ""}`,
      sections: [
        {
          lines: [
            // "Крупный номер заказа" — первым и large (docs/spec/10-
            // tickets.md, "ПЕЧАТЬ") — гашение ищет заказ ПО НОМЕРУ (циферблат
            // во вкладке «Заказы»), это единственное, что реально нужно
            // прочитать издалека на бумажке у актива.
            { label: t.tickets.receiptOrderLabel, value: `№${order.number}`, large: true },
            { label: `${ticket.assetName} · ${ticket.variantName}`, value: "" },
            { label: t.operatorApp.gameRoom.receiptPaymentMethodLabel, value: paymentMethodLabel[order.paymentMethod] ?? order.paymentMethod },
            ...(order.expiresAt
              ? [{ label: t.tickets.receiptExpiresLabel, value: new Date(order.expiresAt).toLocaleDateString(locale) }]
              : []),
          ],
        },
      ],
      totalLine: { label: t.tickets.receiptPriceLabel, value: formatMoneyWithCurrency(ticket.price, locale, currency) },
    };
  }

  const PRINT_SEQUENCE_DELAY_MS = 4000;

  async function printAllTickets(order: NonNullable<typeof lastOrder>) {
    if (printingIndex !== null) return;
    for (let i = 0; i < order.tickets.length; i++) {
      setPrintingIndex(i);
      openPrintDocument(buildTicketReceiptData(order.tickets[i], order), printAvailable.branding);
      if (i < order.tickets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, PRINT_SEQUENCE_DELAY_MS));
      }
    }
    setPrintingIndex(null);
  }

  // "Допечатать потерянный" (docs/spec/10-tickets.md, "ПЕЧАТЬ": "кнопка
  // печати также доступна из карточки заказа во вкладке «Заказы»") —
  // тот же printAllTickets, адаптер к форме OrderDetail (карточка хранит
  // assetId, не имя — резолвится через zone.assets, как и остальной рендер
  // карточки). Аннулированные билеты не печатаются — по ним уже возврат.
  function printOrderTickets(order: OrderDetail) {
    if (!zone) return;
    printAllTickets({
      zoneName: zone.name,
      number: order.number,
      totalSnapshot: order.totalSnapshot,
      expiresAt: order.expiresAt,
      soldAt: order.soldAt,
      paymentMethod: order.paymentMethod,
      tickets: order.tickets
        .filter((tk) => tk.status !== "voided")
        .map((tk) => ({
          id: tk.id,
          assetName: zone.assets.find((a) => a.id === tk.assetId)?.name ?? "",
          variantName: tk.variantNameSnapshot,
          price: tk.priceSnapshot,
        })),
    });
  }

  // ---- Заказы ----
  const [searchNumber, setSearchNumber] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<OrderDetail | null>(null);
  const [recentOrders, setRecentOrders] = useState<OrderDetail[]>([]);
  const [assetFilter, setAssetFilterState] = useState<string>(ALL_ASSETS);
  const [redeeming, setRedeeming] = useState<string | null>(null);

  function setAssetFilter(value: string) {
    setAssetFilterState(value);
    window.localStorage.setItem(ASSET_FILTER_KEY, value);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!zone) return;
    const saved = window.localStorage.getItem(ASSET_FILTER_KEY);
    setAssetFilterState(saved && (saved === ALL_ASSETS || zone.assets.some((a) => a.id === saved)) ? saved : ALL_ASSETS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function loadRecentOrders(zId: string) {
    fetch(`/api/zones/${zId}/ticket-orders`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setRecentOrders(data.orders ?? []));
  }

  useEffect(() => {
    if (tab !== "orders" || !zoneId) return;
    loadRecentOrders(zoneId);
  }, [tab, zoneId]);

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

  function patchOrderTicket(orderId: string, ticketId: string, patch: Partial<OrderTicket>) {
    function apply(o: OrderDetail): OrderDetail {
      if (o.id !== orderId) return o;
      return {
        ...o,
        openTicketsCount: Math.max(0, o.openTicketsCount - 1),
        tickets: o.tickets.map((tk) => (tk.id === ticketId ? { ...tk, ...patch } : tk)),
      };
    }
    setSearchResult((prev) => (prev ? apply(prev) : prev));
    setRecentOrders((prev) => prev.map(apply));
  }

  async function redeemTicket(orderId: string, ticketId: string) {
    setRedeeming(ticketId);
    setSearchError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/redeem`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      patchOrderTicket(orderId, ticketId, { status: data.status, redeemedAt: data.redeemedAt });
    } catch {
      setSearchError(t.operatorApp.gameRoom.networkError);
    } finally {
      setRedeeming(null);
    }
  }

  const highlightAssetId = assetFilter === ALL_ASSETS ? null : assetFilter;

  if (loading) return null;
  if (!zone) return null;

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.tickets.entryTitle}</h1>

        {zones.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">{t.operatorApp.gameRoom.zoneFilterLabel}</Label>
            <div className="min-w-0 flex-1">
              <Select
                value={zone.id}
                onValueChange={(v) => v && selectZone(v)}
                items={zones.map((z) => ({ value: z.id, label: z.name }))}
              >
                <SelectTrigger className="h-11 w-full bg-muted">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {zone.iconKey ? (
                        <AssetOrZoneIcon iconKey={zone.iconKey} className="size-5 shrink-0" />
                      ) : (
                        <MapPin className="size-5 shrink-0 text-muted-foreground" />
                      )}
                      {zone.name}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      <span className="flex items-center gap-2">
                        {z.iconKey ? (
                          <AssetOrZoneIcon iconKey={z.iconKey} className="size-5 shrink-0" />
                        ) : (
                          <Layers className="size-5 shrink-0 text-muted-foreground" />
                        )}
                        {z.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <SegmentedTabs
          options={[
            { key: "sell", label: t.tickets.sellTab },
            { key: "orders", label: t.tickets.ordersTab },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "sell" ? (
          !ticketsAccess ? (
            <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.noSellAccessHint}</p>
          ) : zone.assets.every((a) => a.ticketVariants.length === 0) ? (
            <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.noVariantsYet}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-3">
              {zone.assets.map((a) => {
                const qty = Object.entries(cart)
                  .filter(([key]) => key.startsWith(`${a.id}:`))
                  .reduce((sum, [, v]) => sum + v, 0);
                return (
                  <PressableScale key={a.id}>
                    <button
                      type="button"
                      disabled={!a.active || a.ticketVariants.length === 0}
                      onClick={() => setVariantSheetAssetId(a.id)}
                      className="relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] border-border bg-card text-left disabled:opacity-40"
                    >
                      <div className="relative flex h-20 w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
                        {a.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.photoUrl} alt="" className="size-full object-contain object-center" />
                        ) : a.iconKey ? (
                          <AssetOrZoneIcon iconKey={a.iconKey} className="size-9 text-muted-foreground" />
                        ) : (
                          <Ticket className="size-8 text-muted-foreground" />
                        )}
                        <span
                          className="absolute left-2 top-2 size-3.5 rounded-full ring-2 ring-card"
                          style={{ backgroundColor: a.colorTag }}
                        />
                        {qty > 0 && (
                          <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-[0.75rem] font-bold text-primary-foreground shadow-md">
                            {qty}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-0 px-2 py-1.5">
                        <span className="truncate text-[0.8125rem] font-bold leading-tight tracking-[-0.01em]">{a.name}</span>
                        {/* "Тайл неактивен С ПРИЧИНОЙ" (docs/spec/10-
                            tickets.md, "ЦЕНЫ — НА АКТИВАХ, НЕ ТАРИФЫ") — не
                            просто приглушённый тайл, видимая причина. */}
                        {a.ticketVariants.length === 0 && (
                          <span className="truncate text-[0.6875rem] text-destructive">{t.tickets.noPriceLabel}</span>
                        )}
                      </div>
                    </button>
                  </PressableScale>
                );
              })}
            </div>
          )
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex h-14 items-center justify-center rounded-control border-2 border-input bg-background text-2xl font-extrabold tabular-nums">
                {searchNumber || <span className="text-body-airbnb font-semibold text-muted-foreground">{t.tickets.searchOrderPlaceholder}</span>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
                  <PressableScale key={k}>
                    <button
                      type="button"
                      onClick={() => setSearchNumber((v) => (v + k).slice(0, 6))}
                      className="flex h-14 w-full items-center justify-center rounded-control bg-muted text-xl font-bold tabular-nums"
                    >
                      {k}
                    </button>
                  </PressableScale>
                ))}
                <PressableScale>
                  <button
                    type="button"
                    disabled={!searchNumber}
                    onClick={() => setSearchNumber("")}
                    aria-label={t.common.delete}
                    className="flex h-14 w-full items-center justify-center rounded-control bg-muted text-caption-airbnb font-semibold text-muted-foreground disabled:opacity-40"
                  >
                    {t.common.delete}
                  </button>
                </PressableScale>
                <PressableScale>
                  <button
                    type="button"
                    onClick={() => setSearchNumber((v) => (v + "0").slice(0, 6))}
                    className="flex h-14 w-full items-center justify-center rounded-control bg-muted text-xl font-bold tabular-nums"
                  >
                    0
                  </button>
                </PressableScale>
                <PressableScale>
                  <button
                    type="button"
                    disabled={!searchNumber}
                    onClick={() => setSearchNumber((v) => v.slice(0, -1))}
                    aria-label={t.common.back}
                    className="flex h-14 w-full items-center justify-center rounded-control bg-muted disabled:opacity-40"
                  >
                    <Delete className="size-5" />
                  </button>
                </PressableScale>
              </div>
              <PressableScale>
                <Button
                  type="button"
                  disabled={searching || !searchNumber}
                  onClick={searchOrder}
                  className="h-12 w-full gap-1.5 rounded-control font-bold"
                >
                  <Search className="size-4.5" />
                  {t.tickets.findOrderButton}
                </Button>
              </PressableScale>
            </div>

            {searchError && <p className="text-sm text-destructive">{searchError}</p>}
            {searchResult && (
              <OrderCard
                order={searchResult}
                zone={zone}
                locale={locale}
                paymentMethodLabel={paymentMethodLabel}
                redeeming={redeeming}
                onRedeem={redeemTicket}
                t={t}
                highlightAssetId={highlightAssetId}
                printAvailable={printAvailable.available}
                printing={printingIndex !== null}
                onPrint={printOrderTickets}
              />
            )}

            {zone.assets.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setAssetFilter(ALL_ASSETS)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-caption-airbnb font-semibold whitespace-nowrap",
                    assetFilter === ALL_ASSETS ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {t.tickets.allAssetsLabel}
                </button>
                {zone.assets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAssetFilter(a.id)}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-caption-airbnb font-semibold whitespace-nowrap",
                      assetFilter === a.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <p className="text-caption-airbnb font-semibold text-muted-foreground">{t.tickets.recentOrdersTitle}</p>
              {recentOrders.length === 0 ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.noOrdersYet}</p>
              ) : (
                recentOrders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    zone={zone}
                    locale={locale}
                    paymentMethodLabel={paymentMethodLabel}
                    redeeming={redeeming}
                    onRedeem={redeemTicket}
                    t={t}
                    highlightAssetId={highlightAssetId}
                    printAvailable={printAvailable.available}
                    printing={printingIndex !== null}
                    onPrint={printOrderTickets}
                  />
                ))
              )}
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Корзина зафиксирована снизу, пока в ней что-то есть — тот же
          принцип "плавающей плашки", что баннер истёкших пусков в нижнем
          баре (operator-bottom-nav.tsx). */}
      {tab === "sell" && cartTicketsCount > 0 && (
        <PressableScale className="fixed inset-x-0 z-40 px-3" style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            onClick={() => setCartSheetOpen(true)}
            className="mx-auto flex w-full max-w-md items-center gap-2 rounded-control bg-primary px-3.5 py-2.5 text-left text-primary-foreground shadow-floating md:max-w-xl lg:max-w-2xl"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 text-[0.75rem] font-bold tabular-nums">
              {cartTicketsCount}
            </span>
            <span className="flex-1 truncate text-caption-airbnb font-bold">{t.tickets.cartTitle}</span>
            <Money value={cartTotal} className="font-bold" />
          </button>
        </PressableScale>
      )}

      {/* Выбор варианта цены актива — чипы "название — цена"
          (docs/spec/10-tickets.md, "PWA оператора": "тап по варианту
          добавляет билет в корзину"), каждый тап добавляет ровно один билет,
          sheet остаётся открытым (можно добавлять несколько вариантов
          подряд без промежуточных закрытий); убрать лишнее — в Корзине
          (крестик у строки), степперов здесь нет — квик-тап, не количество. */}
      <BottomSheet open={variantSheetAssetId !== null} onClose={() => setVariantSheetAssetId(null)}>
        {variantSheetAsset && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{variantSheetAsset.name}</h2>
            <div className="flex flex-wrap gap-2">
              {variantSheetAsset.ticketVariants.map((v) => {
                const qty = cart[cartKey(variantSheetAsset.id, v.id)] ?? 0;
                return (
                  <PressableScale key={v.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setQuantity(variantSheetAsset.id, v.id, qty + 1)}
                      className="flex items-center gap-1.5 rounded-full border-[1.5px] border-border bg-card px-4 py-2 text-body-airbnb font-semibold"
                    >
                      {v.name}
                      <span className="text-muted-foreground">—</span>
                      <Money value={v.price} className="font-bold text-primary" />
                    </button>
                    {qty > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex size-5.5 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-bold text-primary-foreground shadow-md">
                        {qty}
                      </span>
                    )}
                  </PressableScale>
                );
              })}
            </div>
            <PressableScale>
              <Button type="button" className="h-12 w-full font-bold" onClick={() => setVariantSheetAssetId(null)}>
                {t.common.close}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      {/* Корзина — строки со степперами (тот же приём, что в sheet выше),
          "Далее" переводит к выбору способа оплаты отдельным sheet поверх
          (не в этом же — тот же принцип, что addFlow в game-room.tsx). */}
      <BottomSheet open={cartSheetOpen} onClose={() => setCartSheetOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.tickets.cartTitle}</h2>
          {currentCartLines.length === 0 ? (
            <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.cartEmpty}</p>
          ) : (
            <>
              {/* "Позиции со степперами" (docs/spec/10-tickets.md, "PWA
                  оператора") — актив · вариант · количество × цена; минус на
                  1 убирает строку целиком (setQuantity(...,0) уже
                  фильтруется в cartLines()). */}
              <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
                {currentCartLines.map((l) => (
                  <div key={`${l.assetId}:${l.variantId}`} className="flex items-center justify-between gap-3 rounded-control bg-muted p-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-airbnb font-semibold">
                        {l.assetName} · {l.variantName}
                      </p>
                      <p className="text-caption-airbnb text-muted-foreground">
                        <Money value={l.price} /> · <Money value={l.price * l.quantity} className="font-bold text-foreground" />
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <PressableScale>
                        <button
                          type="button"
                          aria-label={t.common.delete}
                          onClick={() => setQuantity(l.assetId, l.variantId, l.quantity - 1)}
                          className="flex size-8 items-center justify-center rounded-full border border-border"
                        >
                          <Minus className="size-4" />
                        </button>
                      </PressableScale>
                      <span className="w-5 text-center text-body-airbnb font-extrabold tabular-nums">{l.quantity}</span>
                      <PressableScale>
                        <button
                          type="button"
                          aria-label={t.common.add}
                          onClick={() => setQuantity(l.assetId, l.variantId, l.quantity + 1)}
                          className="flex size-8 items-center justify-center rounded-full border border-border"
                        >
                          <Plus className="size-4" />
                        </button>
                      </PressableScale>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
                <span className="text-caption-airbnb text-muted-foreground">{t.tickets.totalLabel}</span>
                <span className="text-xl font-extrabold tracking-[-0.02em]">
                  <Money value={cartTotal} />
                </span>
              </div>
              <PressableScale>
                <Button
                  type="button"
                  className="h-12 w-full font-bold"
                  onClick={() => {
                    setCartSheetOpen(false);
                    setPaymentOpen(true);
                  }}
                >
                  {t.tickets.continueButton}
                </Button>
              </PressableScale>
            </>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={paymentOpen} onClose={() => setPaymentOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.paymentMethodTitle}</h2>
          <div className="flex flex-col gap-2">
            <ConfirmButton className="relative h-12 w-full font-semibold" disabled={submitting} onConfirm={() => submitOrder("cash")}>
              <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.cashLabel}
            </ConfirmButton>
            <ConfirmButton className="relative h-12 w-full font-semibold" disabled={submitting} onConfirm={() => submitOrder("mobile")}>
              <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.mobileLabel}
            </ConfirmButton>
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                className="relative h-12 w-full font-semibold"
                disabled={submitting}
                onClick={() => {
                  setPaymentOpen(false);
                  setAbonementTarget({ amount: cartTotal });
                }}
              >
                <Wallet className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.abonement.paymentLabel}
              </Button>
            </PressableScale>
          </div>
        </div>
      </BottomSheet>

      <AbonementPaymentSheet
        open={abonementTarget !== null}
        onClose={() => setAbonementTarget(null)}
        amount={abonementTarget?.amount ?? 0}
        onConfirm={(walletId) => submitOrder("abonement", walletId)}
      />

      {/* Успешная продажа — крупный номер заказа + ОДНА кнопка "Распечатать
          билеты" (docs/spec/10-tickets.md, "PWA оператора") + "Новый заказ".
          Кнопка печати внутри делает N последовательных вызовов, по одному
          документу на билет (докс, "ПЕЧАТЬ": решение пользователя 2026-07-21 —
          один документ с разрывами страниц отклонён, на Bluetooth ESC/POS
          давал испорченную вторую "страницу"). */}
      <BottomSheet open={lastOrder !== null} onClose={() => setLastOrder(null)}>
        {lastOrder && (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.tickets.orderDoneTitle}</h2>
            <p className="text-3xl font-extrabold tabular-nums">
              {t.tickets.orderNumberLabel}
              {lastOrder.number}
            </p>
            <p className="text-body-airbnb text-muted-foreground">
              {lastOrder.tickets.length} {t.tickets.ticketsCountLabel.toLowerCase()} · <Money value={lastOrder.totalSnapshot} />
            </p>
            {printAvailable.available && (
              <PressableScale className="w-full">
                <Button
                  type="button"
                  variant="outline"
                  disabled={printingIndex !== null}
                  onClick={() => printAllTickets(lastOrder)}
                  className="w-full gap-1.5 rounded-lg"
                >
                  <Printer className="size-4" />
                  {printingIndex !== null
                    ? `${t.tickets.printTicketButton} ${printingIndex + 1}/${lastOrder.tickets.length}`
                    : t.tickets.printTicketButton}
                </Button>
              </PressableScale>
            )}
            <PressableScale className="w-full">
              <Button type="button" className="h-11 w-full rounded-lg" onClick={() => setLastOrder(null)}>
                {t.tickets.newOrderButton}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function statusLabel(ticket: OrderTicket, order: { expiresAt: string | null }, now: Date, t: ReturnType<typeof useI18n>) {
  if (ticket.status === "voided") return { text: t.tickets.voidedStatusLabel, cls: "text-destructive" };
  if (ticket.status === "redeemed") return { text: t.tickets.redeemedStatusLabel, cls: "text-muted-foreground" };
  if (isOrderExpired(order, now)) return { text: t.tickets.expiredStatusLabel, cls: "text-destructive" };
  return { text: t.tickets.activeStatusLabel, cls: "text-primary" };
}

function OrderCard({
  order,
  zone,
  locale,
  paymentMethodLabel,
  redeeming,
  onRedeem,
  t,
  highlightAssetId,
  printAvailable,
  printing,
  onPrint,
}: {
  order: OrderDetail;
  zone: ZoneCtx;
  locale: string;
  paymentMethodLabel: Record<string, string>;
  redeeming: string | null;
  onRedeem: (orderId: string, ticketId: string) => void;
  t: ReturnType<typeof useI18n>;
  // "Я стою на Карусели" (docs/spec/10-tickets.md, "PWA оператора": "фильтр
  // по активу... в карточках заказов чужие билеты приглушены, свои —
  // первыми") — личная настройка вкладки, не список-фильтр: заказ целиком
  // остаётся видимым, меняется только порядок и приглушение билетов ВНУТРИ
  // карточки.
  highlightAssetId: string | null;
  // "Допечатать потерянный" (docs/spec/10-tickets.md, "ПЕЧАТЬ") — печать из
  // карточки заказа во вкладке «Заказы», не только сразу после продажи.
  printAvailable: boolean;
  printing: boolean;
  onPrint: (order: OrderDetail) => void;
}) {
  const now = new Date();
  const tickets = highlightAssetId
    ? [...order.tickets].sort((a, b) => Number(b.assetId === highlightAssetId) - Number(a.assetId === highlightAssetId))
    : order.tickets;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[1.0625rem] font-extrabold tabular-nums">
            {t.tickets.orderNumberLabel}
            {order.number}
          </p>
          <p className="text-caption-airbnb text-muted-foreground">
            {new Date(order.soldAt).toLocaleString(locale)} · {order.soldByOperatorName}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right tabular-nums">
            <Money value={order.totalSnapshot} className="text-lg font-extrabold" />
            <p className="text-caption-airbnb text-muted-foreground">{paymentMethodLabel[order.paymentMethod] ?? order.paymentMethod}</p>
          </div>
          {printAvailable && (
            <PressableScale>
              <button
                type="button"
                aria-label={t.tickets.printTicketButton}
                disabled={printing}
                onClick={() => onPrint(order)}
                className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground disabled:opacity-40"
              >
                <Printer className="size-4" />
              </button>
            </PressableScale>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {tickets.map((tk) => {
          const st = statusLabel(tk, order, now, t);
          const canRedeem = zone.ticketRedemptionEnabled && tk.status === "active" && !isOrderExpired(order, now);
          const asset = zone.assets.find((a) => a.id === tk.assetId);
          const dimmed = highlightAssetId !== null && tk.assetId !== highlightAssetId;
          return (
            <div
              key={tk.id}
              className={cn("flex items-center justify-between gap-2 rounded-control bg-muted px-3 py-2", dimmed && "opacity-40")}
            >
              <div className="min-w-0">
                <p className="truncate text-body-airbnb font-semibold">
                  {asset?.name ?? ""} · {tk.variantNameSnapshot}
                </p>
                {/* "Без статусов и кнопок" при выключенном гашении
                    (docs/spec/10-tickets.md, "ГАШЕНИЕ — НАСТРОЙКА ЗОНЫ") —
                    статусы не назначаются, показывать нечего. */}
                {zone.ticketRedemptionEnabled && (
                  <p className={cn("text-caption-airbnb font-semibold", st.cls)}>{st.text}</p>
                )}
              </div>
              {canRedeem ? (
                <ConfirmButton
                  className="h-9 shrink-0 px-3 text-xs font-bold"
                  disabled={redeeming === tk.id}
                  onConfirm={() => onRedeem(order.id, tk.id)}
                >
                  {t.tickets.redeemButton}
                </ConfirmButton>
              ) : (
                <Money value={tk.priceSnapshot} className="shrink-0 text-caption-airbnb font-semibold text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>
      {!zone.ticketRedemptionEnabled && <p className="text-caption-airbnb text-muted-foreground">{t.tickets.redemptionDisabledHint}</p>}
    </div>
  );
}
