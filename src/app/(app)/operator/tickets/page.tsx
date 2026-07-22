"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, ChevronDown, ChevronLeft, CreditCard, Delete, Layers, Lock, LockOpen, MapPin, Minus, Plus, Printer, Search, ShoppingCart, Ticket, Trash2, TriangleAlert, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { ConfirmIconButton } from "@/components/confirm-icon-button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { useTicketsCart } from "@/components/operator-cart-context";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { useLiveRefetch } from "@/hooks/use-live-refetch";
import { openPrintDocument, type PrintDocumentData } from "@/lib/print/receipt-document";
import { isTicketsZone } from "@/lib/results-calc";
import { unlockBeep, playErrorChime, playSaveDing } from "@/lib/beep";
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
  printReceiptEnabled: boolean;
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

// Замок по активам (запрос пользователя 2026-07-22: "избежать ситуацию,
// чтобы Сотрудник не погасил Актив не свой" — на одном аттракционе может
// стоять один Сотрудник, на другой день — один Сотрудник на 2-3 сразу) —
// НЕ система прав доступа, чисто UX-подсказка от случайного тапа не туда:
// пока замок открыт, список выбранных активов свободно меняется; закрыт —
// dropdown недоступен, заказы/билеты других активов не показываются вовсе.
// Ключи хранения — на зону (у тенанта может быть больше одной зоны с
// режимом "Билеты", каждая со своим набором активов и своим замком),
// переживают перезагрузку страницы (устройство на точке может стоять
// открытым часами, см. use-live-refetch.ts).
function assetSelectionKey(zoneId: string) {
  return `ticketsSelectedAssets:${zoneId}`;
}
function assetLockKey(zoneId: string) {
  return `ticketsAssetLock:${zoneId}`;
}

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
  // Настройки → Система → "Модули" (запрос пользователя 2026-07-22) —
  // кнопка "Баланс" прячется целиком, если Владелец отключил Клиентов;
  // серверная защита уже есть в /api/zones/[id]/ticket-orders.
  const [clientsEnabled, setClientsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("sell");
  const [error, setError] = useState<string | null>(null);

  function loadContext() {
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
              printReceiptEnabled: boolean;
            }) => ({
              id: z.id,
              name: z.name,
              iconKey: z.iconKey,
              assets: z.assets ?? [],
              ticketRedemptionEnabled: z.ticketRedemptionEnabled,
              printReceiptEnabled: z.printReceiptEnabled,
            })
          );
        if (tickets.length === 0) {
          router.replace("/operator");
          return;
        }
        setZones(tickets);
        setZoneId((prev) => prev ?? tickets[0]?.id ?? null);
        // "Без тумблера вкладка не рендерится" (docs/spec/10-tickets.md,
        // "PWA оператора") — «Заказы» тогда единственная, ставим её сразу,
        // не оставляем "sell" выбранной вкладкой без соответствующего таба.
        const access = Boolean(data.ticketsAccess);
        setTicketsAccess(access);
        setClientsEnabled(data.clientsEnabled !== false);
        if (!access) setTab("orders");
        setLoading(false);
      });
  }

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Держит доступ к зонам/тумблеру продажи свежим, пока экран часами не
  // покидают (запрос пользователя 2026-07-22) — Владелец мог снять доступ к
  // зоне или тумблер "Продажа билетов" без ведома оператора за терминалом.
  useLiveRefetch(loadContext);

  const zone = zones.find((z) => z.id === zoneId) ?? null;

  // ---- Продать ----
  // Корзина — в общем контексте на уровне operator/layout.tsx (запрос
  // пользователя 2026-07-21: "не должно сбрасываться при переключении между
  // пунктами меню"), с ключом по zoneId — так переключение МЕЖДУ tickets-
  // зонами (Select выше) тоже не теряет черновик каждой из них, просто
  // показывает свою.
  const ticketsCart = useTicketsCart();
  const cart: Cart = zoneId ? ticketsCart.getCart(zoneId) : {};
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
  const [successPrinting, setSuccessPrinting] = useState(false);
  function selectZone(id: string) {
    // Корзина НЕ очищается — у каждой зоны своя, в контексте (см. выше),
    // переключение просто показывает корзину новой зоны как есть.
    setZoneId(id);
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
    if (!zoneId) return;
    ticketsCart.setQuantity(zoneId, cartKey(assetId, variantId), quantity);
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
      // Реальные билеты с сервера (createManyAndReturn — см. комментарий
      // ниже у recentOrders), не реконструкция из строк корзины — не зависит
      // от того, что порядок создания на сервере совпадает с порядком строк
      // корзины.
      const ticketRows: { id: string; assetName: string; variantName: string; price: number }[] = data.tickets.map(
        (t: OrderTicket) => ({
          id: t.id,
          assetName: zone.assets.find((a) => a.id === t.assetId)?.name ?? "",
          variantName: t.variantNameSnapshot,
          price: t.priceSnapshot,
        })
      );
      setLastOrder({
        zoneName: zone.name,
        number: data.number,
        totalSnapshot: data.totalSnapshot,
        expiresAt: data.expiresAt,
        soldAt: data.soldAt,
        paymentMethod,
        tickets: ticketRows,
      });
      if (zoneId) ticketsCart.clearCart(zoneId);
      setCartSheetOpen(false);
      setPaymentOpen(false);
      setAbonementTarget(null);
      // Реальный баг, найден пользователем 2026-07-21: "при создании заказа
      // они не сразу появляются в табе Заказы" — и это должно происходить
      // МГНОВЕННО ("должны там быть сразу"), не через повторный запрос ленты
      // после сохранения (тот вариант уже отклонён пользователем как
      // неверный — задержка на round-trip всё ещё заметна). Сервер теперь
      // возвращает реальные билеты заказа (createManyAndReturn, не
      // createMany) — те же id, что нужны для гашения/аннулирования —
      // поэтому можно вставить готовый OrderDetail в начало ленты локально,
      // без единого сетевого запроса.
      setRecentOrders((prev) => [
        {
          id: data.id,
          number: data.number,
          paymentMethod: data.paymentMethod,
          totalSnapshot: data.totalSnapshot,
          expiresAt: data.expiresAt,
          openTicketsCount: data.openTicketsCount,
          soldAt: data.soldAt,
          soldByOperatorName: data.soldByOperatorName,
          tickets: data.tickets,
        },
        ...prev,
      ]);
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

  // Один документ на весь заказ (запрос пользователя 2026-07-21: "печать
  // одним документом. Много диалоговых окон это неправильно") — заменяет
  // прежние N отдельных вызовов печати; каждый билет — своя секция с
  // разрезом (cutLineAfter) между ними, чтобы рулон можно было физически
  // разрезать на отдельные билеты после печати. Общий способ оплаты и
  // итоговая сумма — один раз на весь документ, не дублируются по билетам.
  function buildOrderReceiptData(order: NonNullable<typeof lastOrder>): PrintDocumentData {
    return {
      title: t.tickets.receiptTitle,
      // Дата ПРОДАЖИ (docs/spec/10-tickets.md, "ПЕЧАТЬ": "дата продажи"), не
      // момент печати — реальный баг: при допечатке потерянного билета из
      // вкладки «Заказы» (см. printOrderTickets) новая печать могла случиться
      // в любой день после продажи, new Date() показывал бы неверную дату.
      subtitle: `${order.zoneName} · ${new Date(order.soldAt).toLocaleString(locale)}${printAvailable.operatorName ? ` · ${printAvailable.operatorName}` : ""}`,
      sections: [
        ...order.tickets.map((ticket, i) => ({
          lines: [
            // "Крупный номер заказа" — первым и large (docs/spec/10-
            // tickets.md, "ПЕЧАТЬ") — гашение ищет заказ ПО НОМЕРУ (циферблат
            // во вкладке «Заказы»), это единственное, что реально нужно
            // прочитать издалека на бумажке у актива, повторяется на КАЖДОМ
            // билете — после разреза каждый кусок остаётся самостоятельным.
            { label: t.tickets.receiptOrderLabel, value: `№${order.number}`, large: true },
            { label: `${ticket.assetName} · ${ticket.variantName}`, value: formatMoneyWithCurrency(ticket.price, locale, currency) },
            ...(order.expiresAt
              ? [{ label: t.tickets.receiptExpiresLabel, value: new Date(order.expiresAt).toLocaleDateString(locale) }]
              : []),
          ],
          cutLineAfter: i < order.tickets.length - 1,
        })),
        {
          lines: [
            { label: t.operatorApp.gameRoom.receiptPaymentMethodLabel, value: paymentMethodLabel[order.paymentMethod] ?? order.paymentMethod },
          ],
        },
      ],
      totalLine: { label: t.tickets.totalLabel, value: formatMoneyWithCurrency(order.totalSnapshot, locale, currency) },
    };
  }

  function printOrder(order: NonNullable<typeof lastOrder>) {
    openPrintDocument(buildOrderReceiptData(order), printAvailable.branding);
  }

  // "Допечатать потерянный" (docs/spec/10-tickets.md, "ПЕЧАТЬ": "кнопка
  // печати также доступна из карточки заказа во вкладке «Заказы»") —
  // адаптер к форме OrderDetail (карточка хранит assetId, не имя —
  // резолвится через zone.assets, как и остальной рендер карточки). Печатает
  // ТОЛЬКО живые (status="active") билеты — не только аннулированные
  // (возврат уже случился), но и ПОГАШЕННЫЕ (реальный баг, найден
  // пользователем 2026-07-21: "не должна посылать на печать погашенные
  // билеты" — раньше фильтр был только tk.status !== "voided", погашенные
  // проходили). Услуга по погашенному билету уже оказана, печатать его
  // заново нет смысла — тот же принцип, что уже скрывает погашенные/
  // аннулированные из самого списка карточки (liveTickets выше).
  function printOrderTickets(order: OrderDetail) {
    if (!zone) return;
    printOrder({
      zoneName: zone.name,
      number: order.number,
      totalSnapshot: order.totalSnapshot,
      expiresAt: order.expiresAt,
      soldAt: order.soldAt,
      paymentMethod: order.paymentMethod,
      tickets: order.tickets
        .filter((tk) => tk.status === "active")
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
  const searchErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchResult, setSearchResult] = useState<OrderDetail | null>(null);
  const [recentOrders, setRecentOrders] = useState<OrderDetail[]>([]);
  const [selectedAssetIds, setSelectedAssetIdsState] = useState<string[]>([]);
  const [assetLocked, setAssetLockedState] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [voidingTicket, setVoidingTicket] = useState<string | null>(null);
  const [voidingOrder, setVoidingOrder] = useState<string | null>(null);

  function setSelectedAssetIds(ids: string[]) {
    setSelectedAssetIdsState(ids);
    if (zone) window.localStorage.setItem(assetSelectionKey(zone.id), JSON.stringify(ids));
  }

  function setAssetLocked(value: boolean) {
    setAssetLockedState(value);
    if (zone) window.localStorage.setItem(assetLockKey(zone.id), value ? "1" : "0");
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!zone) return;
    const allIds = zone.assets.map((a) => a.id);
    let saved: string[] = [];
    try {
      saved = JSON.parse(window.localStorage.getItem(assetSelectionKey(zone.id)) ?? "[]");
    } catch {
      saved = [];
    }
    const valid = saved.filter((id) => allIds.includes(id));
    setSelectedAssetIdsState(valid.length > 0 ? valid : allIds);
    setAssetLockedState(window.localStorage.getItem(assetLockKey(zone.id)) === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function loadRecentOrders(zId: string) {
    fetch(`/api/zones/${zId}/ticket-orders`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data) =>
          data &&
          // Только непогашенные (запрос пользователя 2026-07-21) —
          // openTicketsCount>0 значит есть хоть один живой (active) билет;
          // полностью погашенный/аннулированный заказ больше не требует
          // внимания оператора в этой ленте.
          setRecentOrders((data.orders ?? []).filter((o: OrderDetail) => o.openTicketsCount > 0))
      );
  }

  useEffect(() => {
    if (tab !== "orders" || !zoneId) return;
    loadRecentOrders(zoneId);
  }, [tab, zoneId]);

  // "Заказ не найден" — не текстовая строка, а самогаснущий тост поверх
  // циферблата (запрос пользователя 2026-07-21: "Zoom in и Bounce по центру
  // NumPad с характерным звуком ошибки и тухнуть Fade-out и Zoom out через
  // несколько секунд"); поле ввода сбрасывается сразу, не ждёт угасания тоста.
  function flashSearchError(message: string) {
    playErrorChime();
    setSearchError(message);
    setSearchNumber("");
    if (searchErrorTimerRef.current) clearTimeout(searchErrorTimerRef.current);
    searchErrorTimerRef.current = setTimeout(() => setSearchError(null), 2500);
  }

  useEffect(
    () => () => {
      if (searchErrorTimerRef.current) clearTimeout(searchErrorTimerRef.current);
    },
    []
  );

  async function searchOrder() {
    if (!zone || !searchNumber) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const res = await fetch(`/api/zones/${zone.id}/ticket-orders?number=${encodeURIComponent(searchNumber)}`);
      const data = await res.json();
      if (!res.ok) {
        flashSearchError(data.error ?? t.tickets.orderNotFound);
        return;
      }
      // Замок по активам действует и для поиска по номеру (запрос
      // пользователя 2026-07-22: "в заказах также отображается только те
      // активы которые выбраны") — заказ без единого билета выбранного
      // актива для Сотрудника сейчас не существует вовсе, тот же "не
      // найден", а не пустая карточка.
      const order: OrderDetail = data.order;
      if (!order.tickets.some((tk) => tk.status === "active" && selectedAssetIds.includes(tk.assetId))) {
        flashSearchError(t.tickets.orderNotFound);
        return;
      }
      // Одобрительный "мягкий дзинь" при найденном заказе (запрос
      // пользователя 2026-07-21) — тот же playSaveDing, что уже звучит по
      // всему проекту при "Сохранено" (обычно приходит бесплатно через
      // SaveSuccessOverlay у SaveButton, но здесь нет кнопки сохранения —
      // просто найден заказ, поэтому звук нужно вызвать явно).
      playSaveDing();
      setSearchResult(order);
    } catch {
      flashSearchError(t.operatorApp.gameRoom.networkError);
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
    // Погашённый/аннулированный билет сразу пропадает из видимого списка
    // (liveTickets фильтрует по status === "active"), а с ним — только что
    // нажатая кнопка "Погасить": удаление из DOM элемента, на который только
    // что тапнули, сбрасывало скролл страницы наверх (реальный баг, найден
    // пользователем 2026-07-22: "гасит несколько билетов подряд, каждый раз
    // приходится скролить заново"). Явно фиксируем и восстанавливаем позицию
    // скролла вокруг обновления состояния — надёжнее, чем гоняться за точной
    // причиной (потеря фокуса/сжатие layout) в разных браузерах.
    const scrollY = window.scrollY;
    setSearchResult((prev) => (prev ? apply(prev) : prev));
    // Погашение последнего живого билета — заказ сразу выпадает из ленты
    // (тот же фильтр, что при загрузке, см. loadRecentOrders), не ждёт
    // следующей перезагрузки.
    setRecentOrders((prev) => prev.map(apply).filter((o) => o.openTicketsCount > 0));
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
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

  // Аннулирование балансовых заказов — доступно Сотруднику с ticketsAccess
  // (запрос пользователя 2026-07-21: нал/безнал уже прошли через фискальный
  // чек и остаются только у Владельца, а баланс — чисто цифровая операция,
  // без риска скрыть недостачу кассы). Роут сам проверяет paymentMethod и
  // ticketsAccess ещё раз на сервере — эти проверки в UI (OrderCard ниже)
  // только скрывают недоступное действие, не единственная защита.
  async function voidTicket(orderId: string, ticketId: string) {
    setVoidingTicket(ticketId);
    setSearchError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/void`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      patchOrderTicket(orderId, ticketId, { status: data.status });
    } catch {
      setSearchError(t.operatorApp.gameRoom.networkError);
    } finally {
      setVoidingTicket(null);
    }
  }

  async function voidOrder(orderId: string) {
    setVoidingOrder(orderId);
    setSearchError(null);
    try {
      const res = await fetch(`/api/ticket-orders/${orderId}/void`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      for (const ticketId of (data.voidedTicketIds as string[]) ?? []) {
        patchOrderTicket(orderId, ticketId, { status: "voided" });
      }
    } catch {
      setSearchError(t.operatorApp.gameRoom.networkError);
    } finally {
      setVoidingOrder(null);
    }
  }

  const visibleRecentOrders = recentOrders.filter((o) =>
    o.tickets.some((tk) => tk.status === "active" && selectedAssetIds.includes(tk.assetId))
  );

  if (loading) return null;
  if (!zone) return null;

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6" onPointerDownCapture={() => unlockBeep()}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.tickets.entryTitle}</h1>
          {/* Корзина — иконка в одном ряду с заголовком, без слова "Корзина"
              (запрос пользователя 2026-07-21), вместо плавающей плашки
              снизу. Всегда видна, серая/неактивная, пока пуста (запрос
              пользователя того же дня), не пропадает совсем. */}
          {tab === "sell" && (
            <PressableScale>
              <button
                type="button"
                onClick={() => cartTicketsCount > 0 && setCartSheetOpen(true)}
                disabled={cartTicketsCount === 0}
                aria-label={t.tickets.cartTitle}
                className={cn(
                  "relative flex size-10 shrink-0 items-center justify-center rounded-full shadow-floating",
                  cartTicketsCount > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <ShoppingCart className="size-5" />
                {cartTicketsCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-card text-base font-extrabold text-primary shadow-sm">
                    {cartTicketsCount}
                  </span>
                )}
              </button>
            </PressableScale>
          )}
        </div>

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

        {/* "Без тумблера вкладка не рендерится" (docs/spec/10-tickets.md,
            "PWA оператора") — реальный баг, найден пользователем 2026-07-21
            по скриншоту: раньше вкладка «Продать» оставалась в переключателе
            и просто показывала заглушку "Нет доступа". У «Заказы» тумблер
            не нужен (докс: "все операторы с доступом к зоне; существует
            всегда") — с одной вкладкой сам переключатель не нужен, как и
            везде в проекте, где выбирать не из чего. */}
        {ticketsAccess && (
          <SegmentedTabs
            options={[
              { key: "sell", label: t.tickets.sellTab },
              { key: "orders", label: t.tickets.ordersTab },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {tab === "sell" ? (
          zone.assets.every((a) => a.ticketVariants.length === 0) ? (
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
                          <span className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-primary text-lg font-extrabold text-primary-foreground shadow-md">
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
        ) : searchResult ? (
          // "Зайти внутрь" найденного заказа (запрос пользователя
          // 2026-07-21) — циферблат/лента полностью уступают место карточке,
          // не остаются под ней; назад — явной кнопкой, не переключением таба.
          <div className="flex flex-col gap-3">
            <PressableScale className="w-fit">
              <button
                type="button"
                onClick={() => {
                  setSearchResult(null);
                  setSearchNumber("");
                  setSearchError(null);
                }}
                className="flex items-center gap-1 text-body-airbnb font-semibold text-primary"
              >
                <ChevronLeft className="size-4" />
                {t.common.back}
              </button>
            </PressableScale>
            <OrderCard
              order={searchResult}
              zone={zone}
              locale={locale}
              paymentMethodLabel={paymentMethodLabel}
              redeeming={redeeming}
              onRedeem={redeemTicket}
              t={t}
              selectedAssetIds={selectedAssetIds}
              printAvailable={printAvailable.available && zone.printReceiptEnabled}
              onPrint={printOrderTickets}
              ticketsAccess={ticketsAccess}
              voidingTicket={voidingTicket}
              voidingOrder={voidingOrder}
              onVoidTicket={voidTicket}
              onVoidOrder={voidOrder}
            />
          </div>
        ) : (
          <>
            {/* Dropdown с тумблерами по активам + замок (запрос пользователя
                2026-07-22, заменил прежний слайдер-чипы) — не система прав
                доступа, а UX-подсказка от случайной путаницы: на одном
                аттракционе может стоять свой Сотрудник, на другой день один
                Сотрудник обслуживает сразу несколько. Замок закрыт — dropdown
                недоступен, заказы/билеты не выбранных активов не
                показываются нигде на этой вкладке, включая поиск по номеру. */}
            {zone.assets.length > 1 && (
              <AssetAccessControl
                assets={zone.assets}
                selectedAssetIds={selectedAssetIds}
                onChangeSelected={setSelectedAssetIds}
                locked={assetLocked}
                onToggleLocked={() => setAssetLocked(!assetLocked)}
                t={t}
              />
            )}
            <div className="relative flex flex-col gap-3">
              {/* "Заказ не найден" — zoom-in+bounce поверх NumPad, автоматически
                  гаснет fade-out+zoom-out через 2.5с (запрос пользователя
                  2026-07-21), не текстовая строка под кнопкой. */}
              <AnimatePresence>
                {searchError && (
                  <motion.div
                    key="search-error-toast"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{
                      scale: { type: "spring", stiffness: 500, damping: 14 },
                      opacity: { duration: 0.15 },
                    }}
                    className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                  >
                    <div className="flex flex-col items-center gap-1.5 rounded-card bg-destructive px-5 py-3 text-center text-white shadow-floating">
                      <TriangleAlert className="size-9" />
                      <span className="text-lg font-extrabold">{searchError}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* Настоящий input, не просто дисплей (запрос пользователя
                  2026-07-22: "как это будет вести себя не на тач-экране, а
                  на Windows? Мышкой вводить номер неудобно") — нумпад ниже
                  остаётся, но теперь это лишь один из способов ввода, не
                  единственный: с физической клавиатуры печатать тоже можно,
                  достаточно кликнуть в поле (или оно и так в фокусе). */}
              <input
                type="text"
                inputMode="numeric"
                ref={(el) => {
                  // Автофокус — только на устройствах с мышью/клавиатурой
                  // (запрос пользователя 2026-07-22: "не будет ли неудобно,
                  // что сразу и наш нумпад, и штатная клавиатура") — на
                  // тач-устройстве голый autoFocus сразу вызвал бы системную
                  // клавиатуру поверх уже показанного нумпада. Callback-ref,
                  // не useEffect — поле смонтировано условно (таб "Заказы" +
                  // ещё не найден результат), нужен фокус именно в момент
                  // появления, не один раз при монтировании всей страницы.
                  if (el && typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches) {
                    el.focus();
                  }
                }}
                value={searchNumber}
                onChange={(e) => setSearchNumber(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && searchOrder()}
                placeholder={t.tickets.searchOrderPlaceholder}
                className="flex h-14 w-full items-center justify-center rounded-control border-2 border-input bg-background text-center text-2xl font-extrabold tabular-nums placeholder:text-body-airbnb placeholder:font-semibold placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
                  <PressableScale key={k}>
                    <button
                      type="button"
                      onClick={() => setSearchNumber((v) => (v + k).slice(0, 6))}
                      className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-xl font-bold tabular-nums shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] dark:border-input dark:bg-input/30"
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
                    className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-muted-foreground shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] disabled:opacity-40 dark:border-input dark:bg-input/30"
                  >
                    <Trash2 className="size-5" />
                  </button>
                </PressableScale>
                <PressableScale>
                  <button
                    type="button"
                    onClick={() => setSearchNumber((v) => (v + "0").slice(0, 6))}
                    className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-xl font-bold tabular-nums shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] dark:border-input dark:bg-input/30"
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
                    className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] disabled:opacity-40 dark:border-input dark:bg-input/30"
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
                  className="relative h-12 w-full rounded-control pl-14 font-bold"
                >
                  <Search className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                  {t.tickets.findOrderButton}
                </Button>
              </PressableScale>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-caption-airbnb font-semibold text-muted-foreground">{t.tickets.recentOrdersTitle}</p>
              {/* Заказ, ни один билет которого не относится к выбранному
                  активу — не просто приглушается, а не показывается вовсе
                  (реальный баг, найден пользователем 2026-07-22: серый билет
                  всё равно можно было погасить — визуальное приглушение не
                  значит "недоступно"). */}
              {visibleRecentOrders.length === 0 ? (
                <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.noOrdersYet}</p>
              ) : (
                visibleRecentOrders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    zone={zone}
                    locale={locale}
                    paymentMethodLabel={paymentMethodLabel}
                    redeeming={redeeming}
                    onRedeem={redeemTicket}
                    t={t}
                    selectedAssetIds={selectedAssetIds}
                    printAvailable={printAvailable.available && zone.printReceiptEnabled}
                    onPrint={printOrderTickets}
                    ticketsAccess={ticketsAccess}
                    voidingTicket={voidingTicket}
                    voidingOrder={voidingOrder}
                    onVoidTicket={voidTicket}
                    onVoidOrder={voidOrder}
                  />
                ))
              )}
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Выбор варианта цены актива — крупные кнопки во всю ширину, тот же
          единый подход, что у выбора варианта "За вход" в Прибываниях и у
          способа оплаты ниже (запрос пользователя 2026-07-21: "должны быть
          крупнее, как метод оплаты. Используй единый подход в интерфейсе"),
          не мелкие чипы. Каждый тап добавляет ровно один билет, sheet
          остаётся открытым (можно добавлять несколько вариантов подряд без
          промежуточных закрытий); убрать лишнее — в Корзине (степпер),
          степперов здесь нет — квик-тап, не количество. */}
      <BottomSheet open={variantSheetAssetId !== null} onClose={() => setVariantSheetAssetId(null)}>
        {variantSheetAsset && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{variantSheetAsset.name}</h2>
            <div className="flex flex-col gap-2">
              {variantSheetAsset.ticketVariants.map((v) => {
                const qty = cart[cartKey(variantSheetAsset.id, v.id)] ?? 0;
                return (
                  <div key={v.id} className="flex items-center gap-2">
                    <PressableScale className="relative flex-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setQuantity(variantSheetAsset.id, v.id, qty + 1)}
                        className="h-12 w-full justify-between font-semibold"
                      >
                        <span>{v.name}</span>
                        <Money value={v.price} />
                      </Button>
                      {qty > 0 && (
                        <span className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-primary text-base font-extrabold text-primary-foreground shadow-md">
                          {qty}
                        </span>
                      )}
                    </PressableScale>
                    {/* Минус рядом с плюсом (запрос пользователя 2026-07-22:
                        "тап это плюс... должна быть рядом кнопка минус, чтобы
                        отредактировать или удалить при лишнем тапе") — без
                        неё поправить случайный лишний тап можно было только
                        уйдя в Корзину отдельным экраном. */}
                    {qty > 0 && (
                      <PressableScale>
                        <button
                          type="button"
                          aria-label={t.common.delete}
                          onClick={() => setQuantity(variantSheetAsset.id, v.id, qty - 1)}
                          className="flex size-12 shrink-0 items-center justify-center rounded-control border border-border"
                        >
                          <Minus className="size-4" />
                        </button>
                      </PressableScale>
                    )}
                  </div>
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
              <div className="relative flex items-stretch gap-2">
                <PressableScale className="flex flex-1">
                  <Button
                    type="button"
                    className="h-12 w-full font-bold"
                    onClick={() => {
                      setCartSheetOpen(false);
                      setPaymentOpen(true);
                    }}
                  >
                    {t.tickets.payButton}
                  </Button>
                </PressableScale>
                {/* Очистить корзину целиком — через "Точно?" (запрос
                    пользователя 2026-07-21), тот же ConfirmButton, что и
                    везде по проекту для необратимых действий. fillParent —
                    реальный баг, найден пользователем 2026-07-22: без него
                    "Точно?" пытался уместиться в узкий слот иконки корзины и
                    вылезал за край, теперь оверлей на весь ряд целиком, тот
                    же приём, что у замка активов. */}
                <ConfirmButton
                  className="h-12 shrink-0 px-3.5 text-destructive"
                  fillParent
                  onConfirm={() => {
                    if (zoneId) ticketsCart.clearCart(zoneId);
                    // Пустую корзину смотреть незачем (запрос пользователя
                    // 2026-07-21) — sheet закрывается сам сразу после "Точно?".
                    setCartSheetOpen(false);
                  }}
                >
                  <Trash2 className="size-5" />
                  <span className="sr-only">{t.tickets.clearCartAction}</span>
                </ConfirmButton>
              </div>
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
            {clientsEnabled && (
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
            )}
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
          Один вызов window.print() на весь заказ — секции билетов внутри
          документа разделены линией отреза, не CSS page-break (решение
          пользователя 2026-07-21: "распечатывать билеты надо одним
          документом", более раннее решение про N отдельных вызовов
          отменено). */}
      <BottomSheet open={lastOrder !== null} onClose={() => setLastOrder(null)}>
        {lastOrder && (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.tickets.orderDoneTitle}</h2>
            {/* Акцентным цветом — только сам номер, не вся фраза (запрос
                пользователя 2026-07-22: "не всю фразу надо, а именно номер
                заказа") — номер заказа это "ключ" к гашению/аннулированию
                позже (поиск по номеру во вкладке «Заказы»), важно не терять
                из виду независимо от печати. */}
            <p className="text-3xl font-extrabold tabular-nums">
              {t.tickets.orderNumberLabel}
              <span className="text-primary">{lastOrder.number}</span>
            </p>
            <p className="text-body-airbnb text-muted-foreground">
              {lastOrder.tickets.length} {t.tickets.ticketsCountLabel.toLowerCase()} · <Money value={lastOrder.totalSnapshot} />
            </p>
            {printAvailable.available && zone.printReceiptEnabled && (
              <PressableScale className="w-full">
                <Button
                  type="button"
                  variant="outline"
                  disabled={successPrinting}
                  onClick={() => {
                    if (successPrinting) return;
                    setSuccessPrinting(true);
                    printOrder(lastOrder);
                    setTimeout(() => setSuccessPrinting(false), 4000);
                  }}
                  className="w-full gap-1.5 rounded-lg"
                >
                  <Printer className="size-4" />
                  {t.tickets.printTicketButton}
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

/**
 * Dropdown с тумблерами по активам + замок (запрос пользователя 2026-07-22,
 * заменил прежний слайдер-чипы AssetChipsRow) — множественный выбор вместо
 * одиночного: реальный сценарий — один Сотрудник может обслуживать сразу
 * несколько аттракционов, не только один. Замок открыт — можно менять выбор
 * (dropdown кликабелен); закрыт — dropdown задизейблен, случайно поменять
 * выбор нельзя, нужно сперва явно открыть замок. Это НЕ права доступа —
 * чисто клиентская подсказка от невнимательности, сервер ничего не
 * проверяет; Сотрудник в любой момент может открыть замок сам.
 */
function AssetAccessControl({
  assets,
  selectedAssetIds,
  onChangeSelected,
  locked,
  onToggleLocked,
  t,
}: {
  assets: AssetCtx[];
  selectedAssetIds: string[];
  onChangeSelected: (ids: string[]) => void;
  locked: boolean;
  onToggleLocked: () => void;
  t: ReturnType<typeof useI18n>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // "Точно?" — только на снятие замка (запрос пользователя 2026-07-22:
  // "'Точно?' достаточно", решили не городить проверку ПИН-кодом) —
  // закрытие замка безопасное направление (сужает доступ), подтверждения не
  // требует; риск случайности только при открытии.
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);

  function handleLockButtonClick() {
    if (locked) {
      setConfirmingUnlock(true);
    } else {
      onToggleLocked();
    }
  }

  const summaryLabel =
    selectedAssetIds.length === assets.length
      ? t.tickets.allAssetsLabel
      : selectedAssetIds.length === 1
        ? (assets.find((a) => a.id === selectedAssetIds[0])?.name ?? t.tickets.allAssetsLabel)
        : `${t.tickets.assetsSelectedLabel} ${selectedAssetIds.length}`;

  function toggleAsset(id: string) {
    if (selectedAssetIds.includes(id)) {
      // Нельзя снять последний выбранный — иначе список заказов/билетов
      // окажется пуст без всякого объяснения.
      if (selectedAssetIds.length === 1) return;
      onChangeSelected(selectedAssetIds.filter((x) => x !== id));
    } else {
      onChangeSelected([...selectedAssetIds, id]);
    }
  }

  return (
    <>
      <div className="relative flex items-center gap-2">
        {confirmingUnlock && (
          <div className="absolute inset-0 z-10 flex h-11 items-center justify-center gap-3 rounded-control border border-primary bg-card font-semibold shadow-card-rest">
            <span className="text-body-airbnb font-semibold">{t.operatorApp.gameRoom.stopConfirmQuestion}</span>
            <PressableScale>
              <button
                type="button"
                aria-label={t.common.close}
                onClick={() => setConfirmingUnlock(false)}
                className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </PressableScale>
            <PressableScale>
              <button
                type="button"
                aria-label={t.common.confirm}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  window.dispatchEvent(
                    new CustomEvent("save-success-fly", {
                      detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                    })
                  );
                  setConfirmingUnlock(false);
                  onToggleLocked();
                }}
                className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <Check className="size-4" />
              </button>
            </PressableScale>
          </div>
        )}
        <PressableScale className="flex-1">
          <button
            type="button"
            disabled={locked}
            onClick={() => setSheetOpen(true)}
            className="flex h-11 w-full items-center justify-between gap-2 rounded-control border border-border bg-card px-3.5 text-body-airbnb font-semibold shadow-card-rest disabled:opacity-60"
          >
            <span className="truncate">{summaryLabel}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PressableScale>
        <PressableScale className="shrink-0">
          <button
            type="button"
            onClick={handleLockButtonClick}
            aria-label={locked ? t.tickets.assetLockUnlockAction : t.tickets.assetLockLockAction}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-control border shadow-card-rest",
              locked ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
            )}
          >
            {locked ? <Lock className="size-5" /> : <LockOpen className="size-5" />}
          </button>
        </PressableScale>
      </div>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div className="flex flex-col pt-2">
          <h2 className="mb-1 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.tickets.assetFilterTitle}</h2>
          {assets.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
                  {a.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <AssetOrZoneIcon iconKey={a.iconKey} className="size-5 text-muted-foreground" />
                  )}
                </div>
                <span className="truncate text-body-airbnb font-semibold">{a.name}</span>
              </div>
              <Switch checked={selectedAssetIds.includes(a.id)} onCheckedChange={() => toggleAsset(a.id)} />
            </div>
          ))}
        </div>
      </BottomSheet>
    </>
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
  selectedAssetIds,
  printAvailable,
  onPrint,
  ticketsAccess,
  voidingTicket,
  voidingOrder,
  onVoidTicket,
  onVoidOrder,
}: {
  order: OrderDetail;
  zone: ZoneCtx;
  locale: string;
  paymentMethodLabel: Record<string, string>;
  redeeming: string | null;
  onRedeem: (orderId: string, ticketId: string) => void;
  t: ReturnType<typeof useI18n>;
  // Замок по активам (запрос пользователя 2026-07-22) — билеты активов вне
  // этого списка не рендерятся вовсе, не просто приглушаются.
  selectedAssetIds: string[];
  // "Допечатать потерянный" (docs/spec/10-tickets.md, "ПЕЧАТЬ") — печать из
  // карточки заказа во вкладке «Заказы», не только сразу после продажи. Один
  // документ на весь заказ (запрос пользователя 2026-07-21), кулдаун теперь
  // локальный в самой карточке (тот же принцип, что у общего PrintButton) —
  // печать больше не многошаговая, отдельного состояния на уровне страницы
  // не нужно.
  printAvailable: boolean;
  onPrint: (order: OrderDetail) => void;
  // Аннулирование балансовых заказов Сотрудником (запрос пользователя
  // 2026-07-21) — только когда есть доступ к продаже билетов И заказ оплачен
  // балансом (см. canVoid ниже); нал/безнал недоступны здесь вовсе, роут это
  // же проверяет ещё раз на сервере.
  ticketsAccess: boolean;
  voidingTicket: string | null;
  voidingOrder: string | null;
  onVoidTicket: (orderId: string, ticketId: string) => void;
  onVoidOrder: (orderId: string) => void;
}) {
  const now = new Date();
  const canVoid = ticketsAccess && order.paymentMethod === "abonement";
  const [printing, setPrinting] = useState(false);
  function handlePrint() {
    if (printing) return;
    setPrinting(true);
    onPrint(order);
    setTimeout(() => setPrinting(false), 4000);
  }
  // Погашенные и аннулированные билеты не показываются Сотруднику вовсе
  // (запрос пользователя 2026-07-21: "видит только Заказы — должен видеть
  // только активные, аннулированные ему вообще не нужны") — над ними нет
  // доступного действия (гасить/аннулировать нечего), только шум. Истёкший
  // остаётся виден (status всё ещё "active" в БД, isOrderExpired вычисляет
  // на лету) — его ещё можно аннулировать балансом.
  const liveTickets = order.tickets.filter((tk) => tk.status === "active");
  const tickets = liveTickets.filter((tk) => selectedAssetIds.includes(tk.assetId));
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[1.0625rem] font-extrabold tabular-nums">
            {t.tickets.orderNumberLabel}
            <span className="text-primary">{order.number}</span>
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
          {/* Печатать нечего, если живых билетов не осталось (запрос
              пользователя 2026-07-21) — без этой проверки кнопка отправляла
              бы на печать документ без единой секции билета, только шапка +
              способ оплаты. */}
          {printAvailable && liveTickets.length > 0 && (
            <PressableScale>
              <button
                type="button"
                aria-label={t.tickets.printTicketButton}
                disabled={printing}
                onClick={handlePrint}
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
          // Активный и истёкший — можно аннулировать (docs/spec/10-tickets.md,
          // "АННУЛИРОВАНИЕ") — в отличие от canRedeem, тут нет проверки на
          // "истёк" и на ticketRedemptionEnabled.
          const canVoidTicket = canVoid && tk.status === "active";
          const asset = zone.assets.find((a) => a.id === tk.assetId);
          return (
            <div key={tk.id} className="relative flex items-center justify-between gap-2 rounded-control bg-muted px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-body-airbnb font-semibold">
                  {asset?.name ?? ""} · {tk.variantNameSnapshot}
                </p>
                {/* "Без статусов и кнопок" при выключенном гашении
                    (docs/spec/10-tickets.md, "ГАШЕНИЕ — НАСТРОЙКА ЗОНЫ") —
                    статусы не назначаются, показывать нечего. "Активен" тоже
                    не показывается — раз погашенные/аннулированные уже
                    отфильтрованы выше (liveTickets), всё видимое здесь и так
                    активно по умолчанию, наличие кнопки "Погасить"/
                    "Аннулировать" уже это сообщает (запрос пользователя
                    2026-07-21). Остаётся только "Истёк" — единственный
                    статус, который не следует из самого факта присутствия в
                    списке. */}
                {zone.ticketRedemptionEnabled && isOrderExpired(order, now) && (
                  <p className={cn("text-caption-airbnb font-semibold", st.cls)}>{st.text}</p>
                )}
              </div>
              {canRedeem || canVoidTicket ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  {canVoidTicket && (
                    <ConfirmIconButton
                      label={t.tickets.voidTicketAction}
                      disabled={voidingTicket === tk.id}
                      onConfirm={() => onVoidTicket(order.id, tk.id)}
                    />
                  )}
                  {canRedeem && (
                    <ConfirmButton
                      className="h-9 shrink-0 px-3 text-xs font-bold"
                      disabled={redeeming === tk.id}
                      onConfirm={() => onRedeem(order.id, tk.id)}
                      fillParent
                    >
                      {t.tickets.redeemButton}
                    </ConfirmButton>
                  )}
                </div>
              ) : (
                <Money value={tk.priceSnapshot} className="shrink-0 text-caption-airbnb font-semibold text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>
      {!zone.ticketRedemptionEnabled && <p className="text-caption-airbnb text-muted-foreground">{t.tickets.redemptionDisabledHint}</p>}
      {canVoid && liveTickets.length > 0 && (
        <ConfirmButton
          variant="outline"
          className="h-9 w-full text-destructive"
          disabled={voidingOrder === order.id}
          onConfirm={() => onVoidOrder(order.id)}
        >
          {t.tickets.voidOrderAction}
        </ConfirmButton>
      )}
    </div>
  );
}
