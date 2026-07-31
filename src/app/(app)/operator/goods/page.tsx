"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Minus,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { SplitPaymentSheet } from "@/components/split-payment-sheet";
import { useGoodsCart } from "@/components/operator-cart-context";
import { IconActionButton } from "@/components/kebab-menu";
import { COLOR_TAG_PALETTE } from "@/lib/color-tag";
import { Money } from "@/components/money";
import { PrintButton } from "@/components/print/print-button";
import { ActionToast } from "@/components/action-toast";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useActionToast } from "@/hooks/use-action-toast";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import { useLiveRefetch } from "@/hooks/use-live-refetch";
import { playErrorChime } from "@/lib/beep";
import type { PrintDocumentData } from "@/lib/print/receipt-document";
import { formatMoneyWithCurrency, parseMoneyInput } from "@/lib/format";
import { formatTime } from "@/lib/datetime-format";
import type { PaymentLegInput } from "@/lib/payment-split";
import { cn } from "@/lib/utils";

// Те же значения, что GOODS_PAYMENT_METHODS в src/lib/goods.ts — не
// импортируем сам модуль сюда (серверный, тянет prisma/crypto в клиентский
// бандл), значения продублированы, как и раньше делалось для похожих
// констант в клиентских компонентах этого проекта.
const GOODS_SPLIT_METHODS = ["cash", "mobile", "abonement"] as const;

interface CategoryCtx {
  id: string;
  name: string;
}

interface GoodsCtx {
  id: string;
  categoryId: string;
  name: string;
  photoUrl: string | null;
  price: number;
  trackStock: boolean;
  stockQuantity: number | null;
  lowStock: boolean;
}

interface HeldOrderCtx {
  id: string;
  number: number;
  label: string | null;
  createdAt: string;
  total: number;
  lines: { goodsId: string; goodsName: string; quantity: number; priceSnapshot: number }[];
}

const ALL_CATEGORIES = "all";

/**
 * Экран "Товары" в ПВА оператора (docs/spec/09-goods.md, "Продажа") — вход
 * из нижнего бара, только с тумблером goodsAccess (см. operator-bottom-nav.tsx,
 * серверная проверка ещё и на /api/operator/goods*). Поиск + чипы категорий +
 * сетка тайлов — тот же визуальный язык, что "Пуски" (operator/launches),
 * тап по тайлу открывает sheet количество→оплата, оплата абонементом —
 * переиспользует AbonementPaymentSheet как есть (тот же компонент, что у
 * Прибываний/Пусков).
 */
export default function GoodsPage() {
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();

  const [categories, setCategories] = useState<CategoryCtx[]>([]);
  const [goods, setGoods] = useState<GoodsCtx[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const errorToast = useActionToast();
  function flashError(message: string) {
    playErrorChime();
    errorToast.flash(message, "error");
  }

  // Отдельное от goodsAccess право на ревизию остатков (запрос пользователя
  // 2026-07-19) — кебаб-кнопка ревизии в шапке вообще не рендерится без
  // него, серверная проверка — в /api/operator/goods/revisions.
  const [revisionAccess, setRevisionAccess] = useState(false);

  // Настройки → Система (запрос пользователя 2026-07-20) — глобальный
  // тумблер Владельца, серверная проверка — в /api/operator/goods/sale.
  const [goodsAllowBalancePayment, setGoodsAllowBalancePayment] = useState(true);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  // Корзина — тот же принцип, что у Билетов (запрос пользователя 2026-07-21:
  // "такой же принцип корзины должен быть в Товарах, а то сейчас можно
  // продавать только по одному товару"), в общем контексте на уровне
  // operator/layout.tsx — переживает переключение вкладок нижнего бара. Тап
  // по тайлу добавляет 1 сразу (без промежуточного sheet количества),
  // корректировка — степперами в sheet корзины.
  const goodsCart = useGoodsCart();
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [abonementTarget, setAbonementTarget] = useState<{ amount: number } | null>(null);
  // Разбивка оплаты (запрос пользователя 2026-07-26) — необязательный
  // отдельный sheet поверх обычных трёх кнопок, см. SplitPaymentSheet.
  const [splitOpen, setSplitOpen] = useState(false);
  // Модуль печати (запрос пользователя 2026-07-20) — квитанция по факту,
  // кнопка появляется в маленьком sheet сразу после успешной продажи,
  // никогда не печатается автоматически (оператор каждый раз решает сам).
  // Теперь несколько позиций за раз (корзина), не одна.
  const [lastOrder, setLastOrder] = useState<{
    items: { goodsName: string; quantity: number; price: number; amount: number }[];
    total: number;
    paymentMethod: "cash" | "mobile" | "abonement" | "split";
    legs?: { method: string; amount: number }[];
  } | null>(null);
  const printAvailable = useOperatorPrintAvailable();

  // Отложенные заказы (запрос пользователя 2026-07-29: "клиент покупает
  // товары, но ещё сидит за столом, не надо сразу рассчитывать") — номер +
  // цвет тот же приём, что у "Посетитель N" в Прибываниях (COLOR_TAG_PALETTE
  // циклом по номеру), но список — с сервера (GoodsHeldOrder реально
  // существует в БД, остаток уже списан при "Отложить", в отличие от
  // черновика корзины, который чисто локальный до этого момента).
  //
  // editingHeldOrderId — реальный дизайн-разворот (запрос пользователя
  // 2026-07-30: "эти товары должны как бы подниматься снова в корзину, и
  // должна быть такая же механика с кнопкой Отложить обратно") — тап по
  // чипу заказа поднимает его позиции ОБРАТНО в обычную корзину (goodsCart),
  // дальше докупка — тем же тапом по тайлам каталога, что и всегда, "Отложить"
  // синхронизирует правки заново (см. syncHeldOrderCart в lib/goods.ts).
  // Отдельного sheet "только посмотреть" с поиском/списком больше нет —
  // первая версия (поиск+список внутри sheet) была отклонена пользователем.
  const [heldOrders, setHeldOrders] = useState<HeldOrderCtx[]>([]);
  const [editingHeldOrderId, setEditingHeldOrderId] = useState<string | null>(null);
  // payingHeldOrderId — тот же payment-method sheet ниже (paymentOpen),
  // просто submitPayment смотрит на это поле и решает, куда слать оплату:
  // draft-корзину (sellCart) или конкретный отложенный заказ (payHeldOrder).
  const [payingHeldOrderId, setPayingHeldOrderId] = useState<string | null>(null);
  // Сумма именно ИЗ ОТВЕТА синхронизации (запрос пользователя 2026-07-30) —
  // не из heldOrders (тот обновляется отдельным фоновым GET, который может
  // не успеть отработать раньше, чем откроется sheet выбора способа
  // оплаты) — см. proceedToPayment.
  const [payingHeldOrderTotal, setPayingHeldOrderTotal] = useState(0);
  const [holding, setHolding] = useState(false);
  // Переименование заказа (запрос пользователя 2026-07-30: "Стол Васи" и
  // т.п.) — инлайн-редактирование заголовка внутри того же sheet корзины,
  // пока editingHeldOrderId установлен.
  const [renamingOrder, setRenamingOrder] = useState(false);
  const [orderNameDraft, setOrderNameDraft] = useState("");
  const [renamingSubmitting, setRenamingSubmitting] = useState(false);

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionCategory, setRevisionCategory] = useState<string | null>(null);
  const [revisionQuantities, setRevisionQuantities] = useState<Record<string, string>>({});
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, Record<string, string>>>({});
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const { saved: revisionSaved, pulse: revisionPulse } = useSavePulse();

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcilePending, setReconcilePending] = useState<{
    cash: number;
    mobile: number;
    abonement: number;
    sinceReconciliationId: string | null;
  } | null>(null);
  const [reconcileCash, setReconcileCash] = useState("");
  const [reconcileMobile, setReconcileMobile] = useState("");
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  // Вылетающая галочка, как у всех SaveButton по проекту (запрос
  // пользователя 2026-07-19: "не надо писать 'Сохранено', а вылетающая
  // зелёная галочка, как у нас везде"), вместо отдельного текстового
  // экрана-заглушки — pulse закрывает sheet сам, после того как галочка
  // успела показаться.
  const { saved: reconcileSaved, pulse: reconcilePulse } = useSavePulse();

  function load() {
    fetch("/api/operator/goods")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCategories(data.categories ?? []);
        setGoods(data.goods ?? []);
        setRevisionAccess(Boolean(data.revisionAccess));
        setGoodsAllowBalancePayment(data.goodsAllowBalancePayment ?? true);
      })
      .catch(() => flashError(t.operatorApp.gameRoom.networkError))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Держит каталог свежим, пока экран часами не покидают (запрос
  // пользователя 2026-07-22) — деактивация/активация товара Владельцем
  // должна отразиться у Сотрудника без перезахода на экран.
  useLiveRefetch(load);

  function loadHeldOrders() {
    fetch("/api/operator/goods/held-orders")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setHeldOrders(data.orders ?? []);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadHeldOrders();
  }, []);
  // Другой оператор/устройство на этой же точке мог отложить/оплатить/
  // отменить заказ — тот же приём, что у каталога выше (пункт может часами
  // оставаться открытым).
  useLiveRefetch(loadHeldOrders);

  const filteredGoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    return goods.filter((g) => {
      if (categoryFilter !== ALL_CATEGORIES && g.categoryId !== categoryFilter) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [goods, query, categoryFilter]);

  const currentCartLines = Object.entries(goodsCart.cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([goodsId, quantity]) => {
      const g = goods.find((x) => x.id === goodsId);
      return g ? { goodsId, name: g.name, photoUrl: g.photoUrl, price: g.price, quantity } : null;
    })
    .filter((l): l is { goodsId: string; name: string; photoUrl: string | null; price: number; quantity: number } => l !== null);
  const cartCount = currentCartLines.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = currentCartLines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  async function sellCart(paymentMethod: "cash" | "mobile" | "abonement", walletId?: string, legs?: PaymentLegInput[]) {
    if (currentCartLines.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/operator/goods/sale/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: currentCartLines.map((l) => ({ goodsId: l.goodsId, quantity: l.quantity })),
          paymentMethod,
          walletId,
          legs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      if (printAvailable.available) {
        // Суммы строк чека — из ответа сервера (data.items: SoldCartLine[],
        // amount = реальная зачтённая сумма из свежей цены БД внутри
        // транзакции), а не из currentCartLines (цена товара, закэшированная
        // на клиенте при последней загрузке каталога). Реальный баг, найден
        // аудитом 2026-07-24: если владелец меняет цену товара, пока у
        // оператора уже открыта корзина (окно до следующего useLiveRefetch),
        // в БД списывается новая цена, а на чеке печаталась старая — тот же
        // класс расхождения "экран/печать", что уже чинили у Билетов. Имя
        // товара — не денежная величина, безопасно брать из currentCartLines.
        const nameByGoodsId = new Map(currentCartLines.map((l) => [l.goodsId, l.name]));
        const soldItems: { id: string; goodsId: string; quantity: number; amount: number }[] = data.items ?? [];
        setLastOrder({
          items: soldItems.map((s) => ({
            goodsName: nameByGoodsId.get(s.goodsId) ?? "",
            quantity: s.quantity,
            price: s.quantity > 0 ? s.amount / s.quantity : s.amount,
            amount: s.amount,
          })),
          total: data.total,
          paymentMethod: legs && legs.length > 0 ? "split" : paymentMethod,
          legs: legs && legs.length > 0 ? legs : undefined,
        });
      }
      goodsCart.clearCart();
      setCartSheetOpen(false);
      setPaymentOpen(false);
      setAbonementTarget(null);
      setSplitOpen(false);
      load();
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  // Отложить текущую корзину — больше не отдельная кнопка (запрос
  // пользователя 2026-07-31: "кнопка Отложить не нужна, при закрытии заказ
  // может автоматически откладываться"), а неявное действие ПРИ ЗАКРЫТИИ
  // sheet корзины (см. onClose ниже) — свежий черновик становится НОВЫМ
  // пронумерованным заказом (POST), а корзина, поднятая из уже открытого
  // заказа (editingHeldOrderId установлен тапом по чипу, см.
  // openHeldOrderForEdit), синхронизирует ЕГО же содержимое (PUT,
  // syncHeldOrderCart в lib/goods.ts — считает разницу, не пересоздаёт
  // заказ целиком).
  async function commitCart() {
    if (currentCartLines.length === 0) return;
    setHolding(true);
    try {
      const isEditing = Boolean(editingHeldOrderId);
      const url = isEditing
        ? `/api/operator/goods/held-orders/${editingHeldOrderId}/items`
        : "/api/operator/goods/held-orders";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: currentCartLines.map((l) => ({ goodsId: l.goodsId, quantity: l.quantity })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      goodsCart.clearCart();
      setEditingHeldOrderId(null);
      setCartSheetOpen(false);
      loadHeldOrders();
      load();
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setHolding(false);
    }
  }

  // Тап по чипу заказа — поднимает его позиции обратно в обычную корзину
  // (запрос пользователя 2026-07-30), дальше докупка тем же тапом по
  // тайлам каталога, что и всегда. Несколько строк одного товара (могли
  // накопиться за пару "докупок" ранее) суммируются в одно число — корзина
  // всегда хранит "сколько штук", не отдельные порции.
  //
  // Sheet корзины НЕ открывается сам (реальный баг, найден пользователем
  // 2026-07-30: пока sheet открыт, его backdrop перехватывает тапы по
  // каталогу за собой — "докупить" физически невозможно). Оператор
  // остаётся на экране каталога, тайлы сразу тапабельны, счётчик на
  // плавающей кнопке корзины отражает поднятые позиции — тот же сигнал,
  // что и у обычного черновика.
  function openHeldOrderForEdit(order: HeldOrderCtx) {
    goodsCart.clearCart();
    const qtyByGoods = new Map<string, number>();
    for (const line of order.lines) {
      qtyByGoods.set(line.goodsId, (qtyByGoods.get(line.goodsId) ?? 0) + line.quantity);
    }
    for (const [goodsId, quantity] of qtyByGoods) {
      goodsCart.setQuantity(goodsId, quantity);
    }
    setEditingHeldOrderId(order.id);
  }

  // "Оплатить" из корзины — если это правка уже открытого заказа, сначала
  // синхронизирует текущее содержимое корзины на сервер (та же
  // syncHeldOrderCart, что и у "Отложить" в commitCart, просто вместо
  // закрытия сразу ведёт к оплате) и берёт СВЕЖУЮ сумму из ответа — иначе
  // sheet выбора способа оплаты открылся бы со старой суммой заказа, если
  // оператор что-то докупил прямо перед оплатой. Для свежего черновика —
  // просто открывает sheet способа оплаты как раньше.
  async function proceedToPayment() {
    if (!editingHeldOrderId) {
      setCartSheetOpen(false);
      setPaymentOpen(true);
      return;
    }
    setHolding(true);
    try {
      const res = await fetch(`/api/operator/goods/held-orders/${editingHeldOrderId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: currentCartLines.map((l) => ({ goodsId: l.goodsId, quantity: l.quantity })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setPayingHeldOrderId(editingHeldOrderId);
      setPayingHeldOrderTotal(data.total);
      setEditingHeldOrderId(null);
      goodsCart.clearCart();
      setCartSheetOpen(false);
      setPaymentOpen(true);
      loadHeldOrders();
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setHolding(false);
    }
  }

  async function payHeldOrder(paymentMethod: "cash" | "mobile" | "abonement", walletId?: string, legs?: PaymentLegInput[]) {
    if (!payingHeldOrderId) return;
    const order = heldOrders.find((o) => o.id === payingHeldOrderId);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/operator/goods/held-orders/${payingHeldOrderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod, walletId, legs }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      if (printAvailable.available && order) {
        const nameByGoodsId = new Map(order.lines.map((l) => [l.goodsId, l.goodsName]));
        const soldItems: { id: string; goodsId: string; quantity: number; amount: number }[] = data.items ?? [];
        setLastOrder({
          items: soldItems.map((s) => ({
            goodsName: nameByGoodsId.get(s.goodsId) ?? "",
            quantity: s.quantity,
            price: s.quantity > 0 ? s.amount / s.quantity : s.amount,
            amount: s.amount,
          })),
          total: data.total,
          paymentMethod: legs && legs.length > 0 ? "split" : paymentMethod,
          legs: legs && legs.length > 0 ? legs : undefined,
        });
      }
      setPayingHeldOrderId(null);
      setPaymentOpen(false);
      setAbonementTarget(null);
      setSplitOpen(false);
      loadHeldOrders();
      load();
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  // Общая точка входа для sheet выбора способа оплаты (paymentOpen) ниже —
  // решает, куда реально идёт платёж: в черновик корзины (обычная продажа)
  // или в конкретный отложенный заказ, в зависимости от того, что было
  // открыто последним ("Оплатить" в корзине против "Оплатить" в sheet
  // заказа). Один и тот же UI выбора способа оплаты обслуживает оба случая.
  function submitPayment(paymentMethod: "cash" | "mobile" | "abonement", walletId?: string, legs?: PaymentLegInput[]) {
    if (payingHeldOrderId) {
      payHeldOrder(paymentMethod, walletId, legs);
    } else {
      sellCart(paymentMethod, walletId, legs);
    }
  }

  // "Удалить" на отложенном заказе — в отличие от очистки черновика,
  // реально возвращает списанный остаток (см. cancelGoodsHeldOrder в
  // lib/goods.ts). Сценарий "клиент ушёл не расплатившись" отдельно не
  // рассматриваем (решение пользователя 2026-07-29) — это и есть ручное
  // удаление, доступное самому оператору. Сбрасывает и корзину/режим
  // редактирования — сама корзина сейчас показывает ИМЕННО отменяемый заказ.
  async function cancelHeldOrder(orderId: string) {
    try {
      const res = await fetch(`/api/operator/goods/held-orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      goodsCart.clearCart();
      setEditingHeldOrderId(null);
      setCartSheetOpen(false);
      loadHeldOrders();
      load();
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    }
  }

  function openRenameOrder(order: HeldOrderCtx) {
    setOrderNameDraft(order.label ?? "");
    setRenamingOrder(true);
  }

  async function saveOrderName(orderId: string) {
    setRenamingSubmitting(true);
    try {
      const res = await fetch(`/api/operator/goods/held-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: orderNameDraft }),
      });
      if (!res.ok) {
        const data = await res.json();
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setRenamingOrder(false);
      loadHeldOrders();
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setRenamingSubmitting(false);
    }
  }

  const editingOrder = heldOrders.find((o) => o.id === editingHeldOrderId) ?? null;
  // Итог для sheet выбора способа оплаты/AbonementPaymentSheet/SplitPaymentSheet —
  // сумма отложенного заказа, если платим за него, иначе сумма черновика.
  const activePaymentTotal = payingHeldOrderId ? payingHeldOrderTotal : cartTotal;

  const paymentMethodLabel: Record<"cash" | "mobile" | "abonement", string> = {
    cash: t.operatorApp.submit.cashLabel,
    mobile: t.operatorApp.submit.mobileLabel,
    abonement: t.reports.abonementLabel,
  };

  // Несколько позиций в одном чеке (корзина, запрос пользователя 2026-07-21) —
  // не N отдельных документов, как у Билетов (там билеты предъявляются и
  // гасятся ПОШТУЧНО, товары — нет, один чек на всю покупку вполне
  // естественен, как в обычном магазине).
  function buildSaleReceiptData(order: NonNullable<typeof lastOrder>): PrintDocumentData {
    return {
      title: t.goods.receiptTitle,
      subtitle: `${new Date().toLocaleString(locale)}${printAvailable.operatorName ? ` · ${printAvailable.operatorName}` : ""}`,
      sections: [
        {
          lines: [
            // Значение строки — цена ЗА ЕДИНИЦУ (запрос пользователя
            // 2026-07-20: "стоит указывать стоимость за единицу, а не только
            // конечную Сумму") — при quantity>1 это не дублирует "Итого"
            // ниже (там сумма за все единицы), а показывает то, что "Итого"
            // само по себе не объясняет.
            ...order.items.map((item) => ({
              label: `${item.goodsName} × ${item.quantity}`,
              value: formatMoneyWithCurrency(item.price, locale, currency),
              large: order.items.length === 1,
            })),
            // Разбивка оплаты (запрос пользователя 2026-07-26) — своя строка
            // на каждый способ вместо одной общей (PrintLine[] уже поддерживает
            // произвольный список, инфраструктура печати не меняется).
            ...(order.legs
              ? order.legs.map((leg) => ({
                  label: paymentMethodLabel[leg.method as "cash" | "mobile" | "abonement"],
                  value: formatMoneyWithCurrency(leg.amount, locale, currency),
                }))
              : [{ label: t.goods.receiptPaymentMethodLabel, value: paymentMethodLabel[order.paymentMethod as "cash" | "mobile" | "abonement"] }]),
          ],
        },
      ],
      totalLine: { label: t.goods.receiptTotalLabel, value: formatMoneyWithCurrency(order.total, locale, currency) },
    };
  }

  const revisionGoods = revisionCategory
    ? goods.filter((g) => g.categoryId === revisionCategory && g.trackStock)
    : [];

  function openRevision() {
    setRevisionCategory(null);
    setRevisionQuantities({});
    setRevisionDrafts({});
    setRevisionOpen(true);
  }

  function revisionLinesFor(categoryId: string, quantities: Record<string, string>) {
    return goods
      .filter((g) => g.categoryId === categoryId && g.trackStock)
      .map((g) => ({ goodsId: g.id, actualQuantity: Number(quantities[g.id]) }))
      .filter((l) => Number.isInteger(l.actualQuantity) && l.actualQuantity >= 0);
  }

  function categoryHasRevisionDraft(categoryId: string) {
    const draft = revisionDrafts[categoryId];
    return !!draft && revisionLinesFor(categoryId, draft).length > 0;
  }

  function openRevisionCategory(categoryId: string) {
    setRevisionQuantities(revisionDrafts[categoryId] ?? {});
    setRevisionCategory(categoryId);
  }

  function closeRevisionCategory() {
    if (revisionCategory) {
      setRevisionDrafts((prev) => ({ ...prev, [revisionCategory]: revisionQuantities }));
    }
    setRevisionCategory(null);
    setRevisionQuantities({});
  }

  // Черновики по категориям (запрос пользователя 2026-07-19, тот же приём,
  // что у Владельца в /goods) — заходишь в категорию, меняешь остатки,
  // "Назад" к списку категорий, идёшь в другую; на сервер уходит одним
  // коммитом только по нажатию общего "Сохранить" из списка категорий.
  async function saveAllRevisions() {
    const groups = categories
      .map((c) => ({ categoryId: c.id, lines: revisionLinesFor(c.id, revisionDrafts[c.id] ?? {}) }))
      .filter((g) => g.lines.length > 0);
    if (groups.length === 0) {
      flashError(t.goods.noTrackedGoods);
      return;
    }
    setRevisionSubmitting(true);
    try {
      const res = await fetch("/api/operator/goods/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      load();
      revisionPulse(() => {
        setRevisionDrafts({});
        setRevisionOpen(false);
      });
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setRevisionSubmitting(false);
    }
  }

  function openReconcile() {
    setReconcileCash("");
    setReconcileMobile("");
    setReconcilePending(null);
    setReconcileOpen(true);
    fetch("/api/operator/goods/reconciliations")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setReconcilePending(data.pending))
      .catch(() => flashError(t.operatorApp.gameRoom.networkError));
  }

  async function saveReconciliation() {
    const actualCash = parseMoneyInput(reconcileCash);
    const actualMobile = parseMoneyInput(reconcileMobile);
    if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) return;
    setReconcileSubmitting(true);
    try {
      const res = await fetch("/api/operator/goods/reconciliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualCash,
          actualMobile,
          sinceReconciliationId: reconcilePending?.sinceReconciliationId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      reconcilePulse(() => setReconcileOpen(false));
    } catch {
      flashError(t.operatorApp.gameRoom.networkError);
    } finally {
      setReconcileSubmitting(false);
    }
  }

  const reconcileDifference =
    reconcilePending && (reconcileCash || reconcileMobile)
      ? parseMoneyInput(reconcileCash) + parseMoneyInput(reconcileMobile) - reconcilePending.cash - reconcilePending.mobile
      : null;

  if (loading) return null;

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-xl lg:max-w-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.goods.navLabel}</h1>
          <div className="flex items-center gap-2">
            {/* "Сдать кассу" — рядом с заголовком, не в кебаб-меню (запрос
                пользователя 2026-07-19), по стилю "Сдать итоги" с главной
                (та же SVG-иконка), только горизонтально. */}
            <PressableScale>
              <Button
                type="button"
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold"
                onClick={openReconcile}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/icon-library/app-icons/calculator.svg" alt="" className="size-5" />
                {t.goods.reconciliationTitle}
              </Button>
            </PressableScale>
            {/* Ревизия остатков — отдельное право revisionAccess (запрос
                пользователя 2026-07-19: "если Сотруднику не доступна Ревизия
                остатков, то и кебаб меню не должно быть") — кнопки нет
                вообще, не заблокированная. Одно действие, поэтому кебаб
                открывает ревизию напрямую, без промежуточного меню. */}
            {revisionAccess && (
              <PressableScale>
                <button
                  type="button"
                  onClick={openRevision}
                  aria-label={t.goods.revisionTitle}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground"
                >
                  <ClipboardList className="size-5" />
                </button>
              </PressableScale>
            )}
            {/* Корзина — та же иконка-кнопка, что у Билетов (запрос
                пользователя 2026-07-21: "такой же принцип корзины"), всегда
                видна, серая пока пуста. Пока корзина поднята из отложенного
                заказа (editingHeldOrderId) — цвет кнопки берёт цвет ИМЕННО
                этого заказа (запрос пользователя 2026-07-31), тот же
                COLOR_TAG_PALETTE по номеру, что у чипа/бейджа заказа, чтобы
                было видно, в какой заказ сейчас идёт докупка. */}
            <PressableScale>
              <button
                type="button"
                onClick={() => cartCount > 0 && setCartSheetOpen(true)}
                disabled={cartCount === 0}
                aria-label={t.tickets.cartTitle}
                style={
                  editingOrder
                    ? { backgroundColor: COLOR_TAG_PALETTE[(editingOrder.number - 1) % COLOR_TAG_PALETTE.length] }
                    : undefined
                }
                className={cn(
                  "relative flex size-10 shrink-0 items-center justify-center rounded-full",
                  editingOrder ? "text-white" : cartCount > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <ShoppingCart className="size-5" />
                {cartCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-card text-base font-extrabold text-primary shadow-sm">
                    {cartCount}
                  </span>
                )}
              </button>
            </PressableScale>
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.goods.searchPlaceholder}
            className="h-12 rounded-control bg-muted pl-10.5"
          />
        </div>

        {categories.length > 0 && (
          <CategoryChipsRow categories={categories} categoryFilter={categoryFilter} onSelect={setCategoryFilter} t={t} />
        )}

        {goods.length === 0 ? (
          <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.emptyCatalog}</p>
        ) : filteredGoods.length === 0 ? (
          <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.goods.noResults}</p>
        ) : (
          // Квадратные тайлы, минимум 3 в ряд на телефоне, больше на
          // планшете (запрос пользователя 2026-07-19) — auto-fill/minmax
          // вместо фиксированных grid-cols-N: число колонок само
          // подстраивается под ширину экрана, а не по жёстким брейкпоинтам.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-3">
            {filteredGoods.map((g) => {
              const qty = goodsCart.cart[g.id] ?? 0;
              return (
                <PressableScale key={g.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => goodsCart.setQuantity(g.id, qty + 1)}
                    className="flex w-full flex-col overflow-hidden rounded-card border-[1.5px] border-border bg-card text-left shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] disabled:opacity-40"
                  >
                    {/* Изображения товаров — 1:1 (информация пользователя
                        2026-07-19), object-cover заполняет квадрат ровно. */}
                    <div className="relative aspect-square w-full overflow-hidden bg-primary/10">
                      {g.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.photoUrl} alt="" className="size-full object-cover object-center" />
                      ) : (
                        <div className="flex size-full items-center justify-center">
                          <ShoppingBag className="size-7 text-primary/50" />
                        </div>
                      )}
                      {g.lowStock && (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[0.625rem] font-bold text-white">
                          {t.goods.lowStockBadge}
                        </span>
                      )}
                      {qty > 0 && (
                        <span className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-primary text-lg font-extrabold text-primary-foreground shadow-md">
                          {qty}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-0 px-2 py-1.5">
                      {/* min-h-[2lh] — резерв под 2 строки всегда (запрос
                          пользователя 2026-07-28), чтобы короткие названия
                          не давали тайл ниже соседних с длинным названием
                          в той же сетке. Цена — отдельной строкой под
                          названием, выровнена по правому краю (запрос того
                          же дня). */}
                      <span className="line-clamp-2 min-h-[2lh] text-[0.8125rem] font-bold leading-tight tracking-[-0.01em] wrap-break-word">{g.name}</span>
                      <span className="text-right tabular-nums text-[0.75rem] font-semibold leading-tight text-primary">
                        <Money value={g.price} />
                      </span>
                    </div>
                  </button>
                </PressableScale>
              );
            })}
          </div>
        )}

      </div>

      {/* Отложенные заказы (запрос пользователя 2026-07-29) — компактный
          горизонтально-скроллящийся ряд кнопок ("больше как кнопки со
          скроллингом, не большие тайлы"), сразу над нижним баром (тот же
          bottom, что PoweredByMark в operator-branding-chrome.tsx — 4.5rem,
          эмпирическая высота nav-glass). Только на этом экране, не глобально
          (решение пользователя 2026-07-29). Цвет — тот же циклический
          COLOR_TAG_PALETTE, что у "Посетитель N" в Прибываниях, по номеру
          заказа, не имени/tenant-акценту. Скролл стрелками, не полосой
          прокрутки (запрос пользователя 2026-07-30: "как в Категориях
          товаров") — HeldOrdersRow ниже переиспользует тот же приём, что
          CategoryChipsRow. */}
      {heldOrders.length > 0 && (
        <HeldOrdersRow orders={heldOrders} onSelect={openHeldOrderForEdit} t={t} />
      )}

      {/* Корзина — позиции со степперами (тот же принцип, что у Билетов,
          запрос пользователя 2026-07-21), минус на 1 убирает строку целиком.
          Тот же sheet обслуживает и правку уже отложенного заказа (запрос
          пользователя 2026-07-30: "товары должны как бы подниматься снова
          в корзину" — openHeldOrderForEdit поднимает позиции заказа СЮДА,
          не в отдельный sheet с поиском+списком, который был отклонён) —
          заголовок/кнопка меняются в зависимости от editingOrder.
          "Оплатить" — та же кнопка/функция, что и для свежего черновика
          (proceedToPayment сама решает, куда слать: новый заказ или
          синхронизация уже открытого).
          Нет отдельной кнопки "Отложить" (запрос пользователя 2026-07-31) —
          закрытие sheet ЛЮБЫМ способом (крестик/бэкдроп/свайп/Escape, всё
          сводится к этому единственному onClose) само откладывает
          непустую корзину: новый заказ, если черновик свежий, или синхронизация,
          если это правка уже открытого. Если это была правка и корзину
          опустошили начисто — значит заказ решили удалить, не оставлять
          пустым "висящим". Явные "Оплатить"/"Удалить" остаются отдельными
          кнопками — единственные два других исхода, о которых просил
          пользователь ("иначе он должен либо оплатить, либо удалить"). */}
      <BottomSheet
        open={cartSheetOpen}
        onClose={() => {
          setRenamingOrder(false);
          if (editingHeldOrderId && currentCartLines.length === 0) {
            cancelHeldOrder(editingHeldOrderId);
          } else if (currentCartLines.length > 0) {
            commitCart();
          } else {
            setCartSheetOpen(false);
          }
        }}
      >
        <div className="flex flex-col gap-3 pt-2">
          {renamingOrder && editingOrder ? (
            <form
              // pr-2 — реальный баг, найден пользователем 2026-07-31: крестик
              // закрытия sheet абсолютно спозиционирован (right-3 + size-10 =
              // 52px от края), а контейнер контента резервирует под него
              // только pr-12 (48px) — при flex-1 на весь ряд кнопка-галочка
              // вплотную к краю содержимого залезает на те недостающие 4px
              // под крестик. Компенсируем прямо здесь, а не правкой BottomSheet
              // (общий компонент для всех sheet проекта, трогать без нужды
              // рискованно).
              className="flex items-center gap-2 pr-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveOrderName(editingOrder.id);
              }}
            >
              <Input
                autoFocus
                value={orderNameDraft}
                onChange={(e) => setOrderNameDraft(e.target.value)}
                placeholder={`${t.goods.heldOrderChipLabel} ${editingOrder.number}`}
                // min-w-0 — реальный баг, найден пользователем 2026-07-30:
                // Input сам по себе w-full, без min-w-0 flex-ребёнок
                // игнорирует доступную ширину ряда (min-width:auto по
                // умолчанию) и вылезает под крестик закрытия sheet вместо
                // того чтобы ужаться под кнопку-галочку рядом.
                className="h-10 min-w-0 flex-1"
              />
              <PressableScale className="shrink-0">
                <Button type="submit" size="icon" disabled={renamingSubmitting} className="size-10 shrink-0 rounded-lg" aria-label={t.common.save}>
                  <Check className="size-4" />
                </Button>
              </PressableScale>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {editingOrder ? (
                <h2 className="flex min-w-0 items-center gap-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: COLOR_TAG_PALETTE[(editingOrder.number - 1) % COLOR_TAG_PALETTE.length] }}
                  >
                    {editingOrder.number}
                  </span>
                  <span className="min-w-0 truncate">{editingOrder.label || `${t.goods.heldOrderChipLabel} ${editingOrder.number}`}</span>
                  <IconActionButton icon={Pencil} onClick={() => openRenameOrder(editingOrder)} label={t.common.rename} />
                </h2>
              ) : (
                <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.tickets.cartTitle}</h2>
              )}
            </div>
          )}
          {currentCartLines.length === 0 ? (
            <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.tickets.cartEmpty}</p>
          ) : (
            <>
              <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
                {currentCartLines.map((l) => (
                  <div key={l.goodsId} className="flex items-center gap-3 rounded-control bg-muted p-3">
                    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-card">
                      {l.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.photoUrl} alt="" className="size-full object-contain object-center" />
                      ) : (
                        <ShoppingBag className="size-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-airbnb font-semibold">{l.name}</p>
                      <p className="text-caption-airbnb text-muted-foreground">
                        <Money value={l.price} /> · <Money value={l.price * l.quantity} className="font-bold text-foreground" />
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <PressableScale>
                        <button
                          type="button"
                          aria-label={t.common.delete}
                          onClick={() => goodsCart.setQuantity(l.goodsId, l.quantity - 1)}
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
                          onClick={() => goodsCart.setQuantity(l.goodsId, l.quantity + 1)}
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
                <span className="text-caption-airbnb text-muted-foreground">{t.goods.totalLabel}</span>
                <span className="text-xl font-extrabold tracking-[-0.02em]">
                  <Money value={cartTotal} />
                </span>
              </div>
              <div className="relative flex items-stretch gap-2">
                <PressableScale className="flex flex-1">
                  <Button type="button" className="h-12 w-full font-bold" disabled={holding} onClick={proceedToPayment}>
                    {t.tickets.payButton}
                  </Button>
                </PressableScale>
                {/* Очистить корзину целиком — через "Точно?" (запрос
                    пользователя 2026-07-21), тот же ConfirmButton, что и
                    везде по проекту для необратимых действий. fillParent —
                    реальный баг, найден пользователем 2026-07-22 в Билетах
                    (тот же паттерн здесь): без него "Точно?" вылезал за
                    пределы узкого слота иконки корзины, теперь оверлей на
                    весь ряд целиком, тот же приём, что у замка активов.
                    Для правки отложенного заказа — реально отменяет ЕГО
                    (cancelHeldOrder, возвращает остаток), не просто очистка
                    локального черновика. */}
                <ConfirmButton
                  className="h-12 shrink-0 px-3.5 text-destructive"
                  fillParent
                  onConfirm={() => {
                    if (editingHeldOrderId) {
                      cancelHeldOrder(editingHeldOrderId);
                      return;
                    }
                    goodsCart.clearCart();
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

      <BottomSheet open={paymentOpen} onClose={() => { setPaymentOpen(false); setPayingHeldOrderId(null); }}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.paymentMethodTitle}</h2>
          <div className="flex flex-col gap-2">
            <ConfirmButton className="relative h-12 w-full font-semibold" disabled={submitting} onConfirm={() => submitPayment("cash")}>
              <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.cashLabel}
            </ConfirmButton>
            <ConfirmButton
              className="relative h-12 w-full font-semibold"
              disabled={submitting}
              onConfirm={() => submitPayment("mobile")}
            >
              <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.mobileLabel}
            </ConfirmButton>
            {goodsAllowBalancePayment && (
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  className="relative h-12 w-full font-semibold"
                  disabled={submitting}
                  onClick={() => {
                    setPaymentOpen(false);
                    setAbonementTarget({ amount: activePaymentTotal });
                  }}
                >
                  <Wallet className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                  {t.operatorApp.abonement.paymentLabel}
                </Button>
              </PressableScale>
            )}
          </div>
          <PressableScale className="w-fit">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto gap-1 px-0 text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setPaymentOpen(false);
                setSplitOpen(true);
              }}
            >
              <ArrowLeftRight className="size-3.5" />
              {t.splitPayment.title}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <AbonementPaymentSheet
        open={abonementTarget !== null}
        onClose={() => { setAbonementTarget(null); setPayingHeldOrderId(null); }}
        amount={abonementTarget?.amount ?? 0}
        onConfirm={(walletId) => submitPayment("abonement", walletId)}
      />

      <SplitPaymentSheet
        open={splitOpen}
        onClose={() => { setSplitOpen(false); setPayingHeldOrderId(null); }}
        total={activePaymentTotal}
        allowedMethods={GOODS_SPLIT_METHODS}
        clientsEnabled={goodsAllowBalancePayment}
        submitting={submitting}
        onSubmit={(legs) => submitPayment("cash", undefined, legs)}
      />

      <BottomSheet
        open={revisionOpen}
        onClose={() => {
          setRevisionOpen(false);
          setRevisionCategory(null);
          setRevisionDrafts({});
        }}
      >
        <div className="flex flex-col gap-3 pt-2">
          {!revisionCategory ? (
            <>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.revisionTitle}</h2>
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <PressableScale key={c.id}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-full justify-between font-semibold"
                      onClick={() => openRevisionCategory(c.id)}
                    >
                      {c.name}
                      {categoryHasRevisionDraft(c.id) && <Check className="size-4 shrink-0 text-primary" />}
                    </Button>
                  </PressableScale>
                ))}
              </div>
              <PressableScale>
                <SaveButton type="button" className="h-12 w-full" disabled={revisionSubmitting} saved={revisionSaved} onClick={saveAllRevisions} />
              </PressableScale>
            </>
          ) : (
            <>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
                {categories.find((c) => c.id === revisionCategory)?.name}
              </h2>
              {revisionGoods.length === 0 ? (
                <p className="text-caption-airbnb text-muted-foreground">{t.goods.noTrackedGoods}</p>
              ) : (
                <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
                  {revisionGoods.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-airbnb font-semibold">{g.name}</p>
                        <p className="text-caption-airbnb text-muted-foreground">
                          {t.goods.calculatedLabel}: {g.stockQuantity ?? 0}
                        </p>
                      </div>
                      <Input
                        inputMode="numeric"
                        value={revisionQuantities[g.id] ?? ""}
                        onChange={(e) =>
                          setRevisionQuantities((prev) => ({ ...prev, [g.id]: e.target.value.replace(/\D/g, "") }))
                        }
                        placeholder={String(g.stockQuantity ?? 0)}
                        className="h-11 w-20 rounded-control bg-muted text-center tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              )}
              <PressableScale>
                <Button type="button" variant="outline" className="h-12 w-full gap-1.5 font-bold" onClick={closeRevisionCategory}>
                  <ChevronLeft className="size-4" />
                  {t.common.back}
                </Button>
              </PressableScale>
            </>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={reconcileOpen} onClose={() => setReconcileOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.reconciliationTitle}</h2>
          {reconcilePending === null ? null : (
            <>
              {/* Расчётная подсказка — в ОДНОМ ряду с полем ввода, не
                  отдельной карточкой сверху (запрос пользователя 2026-07-30:
                  "как сделал в Сдаче итогов" — тот же паттерн, что уже
                  применён в operator/submit/page.tsx для Счётчиков/Билетов:
                  мелкое кликабельное число слева от поля, тап подставляет
                  значение, поле по-прежнему вводится вручную — сверка факта
                  с расчётом остаётся реальной проверкой, не самозаполнением). */}
              <div className="flex items-stretch gap-2">
                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="reconcileCash" className="flex items-center gap-1.5">
                      <PaymentMethodIcon method="cash" className="size-3.5 shrink-0" />
                      {t.operatorApp.submit.cashLabel}
                    </Label>
                    <div className="flex items-center gap-2">
                      {reconcilePending.cash > 0 && (
                        <PressableScale className="shrink-0">
                          <button
                            type="button"
                            onClick={() => setReconcileCash(String(reconcilePending.cash))}
                            className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control px-2.5"
                          >
                            <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
                              <Money value={reconcilePending.cash} />
                            </span>
                            <span className="text-[0.625rem] leading-none text-muted-foreground/40">
                              {t.operatorApp.submit.tapHintCaption}
                            </span>
                          </button>
                        </PressableScale>
                      )}
                      <MoneyInput
                        id="reconcileCash"
                        autoFocus
                        scale="lg"
                        inputMode="numeric"
                        className="h-14 rounded-control bg-muted text-lg font-bold"
                        value={reconcileCash}
                        onChange={(e) => setReconcileCash(e.target.value.replace(/[^\d.,]/g, ""))}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="reconcileMobile" className="flex items-center gap-1.5">
                      <PaymentMethodIcon method="mobile" className="size-3.5 shrink-0" />
                      {t.operatorApp.submit.mobileLabel}
                    </Label>
                    <div className="flex items-center gap-2">
                      {reconcilePending.mobile > 0 && (
                        <PressableScale className="shrink-0">
                          <button
                            type="button"
                            onClick={() => setReconcileMobile(String(reconcilePending.mobile))}
                            className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control px-2.5"
                          >
                            <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
                              <Money value={reconcilePending.mobile} />
                            </span>
                            <span className="text-[0.625rem] leading-none text-muted-foreground/40">
                              {t.operatorApp.submit.tapHintCaption}
                            </span>
                          </button>
                        </PressableScale>
                      )}
                      <MoneyInput
                        id="reconcileMobile"
                        scale="lg"
                        inputMode="numeric"
                        className="h-14 rounded-control bg-muted text-lg font-bold"
                        value={reconcileMobile}
                        onChange={(e) => setReconcileMobile(e.target.value.replace(/[^\d.,]/g, ""))}
                      />
                    </div>
                  </div>
                  {/* Баланс абонемента — без ручного поля (списывается
                      автоматически, сверять физически нечего), поэтому не
                      попадает в пару "подсказка+поле" выше, просто короткая
                      строка-справка, если есть чем. */}
                  {reconcilePending.abonement > 0 && (
                    <p className="inline-flex items-center gap-1 text-caption-airbnb text-muted-foreground">
                      <PaymentMethodIcon method="abonement" className="size-3.5 shrink-0" />
                      {t.operatorApp.abonement.paymentLabel}:{" "}
                      <span className="font-bold text-foreground">
                        <Money value={reconcilePending.abonement} />
                      </span>
                    </p>
                  )}
                </div>
                <PressableScale className="flex">
                  {/* Вертикальная (запрос пользователя 2026-07-30: "как в
                      Сдаче итогов") — тот же приём, что уже применён в
                      operator/submit/page.tsx (2026-07-28): узкая колонка
                      (w-14) + текст в столбик (writing-mode: vertical-rl),
                      освобождает горизонтальное место полям слева, не
                      просто растянутая по высоте обычная кнопка. */}
                  <SaveButton
                    className="h-full w-14 min-w-0 flex-col gap-1.5 rounded-control px-1 font-bold"
                    saved={reconcileSaved}
                    disabled={reconcileSubmitting}
                    onClick={saveReconciliation}
                  >
                    <span className="[writing-mode:vertical-rl] rotate-180">{t.common.save}</span>
                  </SaveButton>
                </PressableScale>
              </div>

              {reconcileDifference !== null && (
                <p
                  className={cn(
                    "flex items-center gap-1.5 text-caption-airbnb font-semibold tabular-nums",
                    reconcileDifference === 0 ? "text-primary" : "text-warning"
                  )}
                >
                  {t.operatorApp.submit.difference}
                  {reconcileDifference !== 0 && <TriangleAlert className="size-3.5 shrink-0" />}
                  {reconcileDifference > 0 ? "+" : ""}
                  <Money value={reconcileDifference} />
                </p>
              )}
            </>
          )}
        </div>
      </BottomSheet>

      {/* Квитанция продажи (запрос пользователя 2026-07-20) — печать по требованию,
          кнопка видна только если у тенанта включена печать и на этом
          устройстве стоит принтер (useOperatorPrintAvailable); без этого
          весь sheet просто закрывается сам без лишнего экрана "Продано". */}
      <BottomSheet open={lastOrder !== null} onClose={() => setLastOrder(null)}>
        {lastOrder && (
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-6" />
            </div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.goods.saleDoneTitle}</h2>
            <div className="flex w-full flex-col gap-1">
              {lastOrder.items.map((item, i) => (
                <p key={i} className="flex items-center justify-between text-body-airbnb text-muted-foreground">
                  <span className="truncate">
                    {item.goodsName} × {item.quantity}
                  </span>
                  <Money value={item.amount} className="shrink-0 font-semibold text-foreground" />
                </p>
              ))}
            </div>
            <div className="flex w-full items-center justify-between border-t border-border pt-3">
              <span className="text-caption-airbnb text-muted-foreground">{t.goods.totalLabel}</span>
              <span className="text-xl font-extrabold tracking-[-0.02em]">
                <Money value={lastOrder.total} />
              </span>
            </div>
            {printAvailable.available && (
              <PrintButton
                label={t.goods.printReceiptButton}
                data={buildSaleReceiptData(lastOrder)}
                branding={printAvailable.branding}
                className="w-full gap-1.5 rounded-lg"
              />
            )}
            <PressableScale className="w-full">
              <Button type="button" variant="outline" className="h-11 w-full rounded-lg" onClick={() => setLastOrder(null)}>
                {t.common.close}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>
      <ActionToast message={errorToast.message} variant={errorToast.variant} />
    </div>
  );
}

function CategoryChipsRow({
  categories,
  categoryFilter,
  onSelect,
  t,
}: {
  categories: CategoryCtx[];
  categoryFilter: string;
  onSelect: (id: string) => void;
  t: ReturnType<typeof useI18n>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollState();
  }, [categories]);

  function scrollByAmount(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  // Белая плашка + стрелки по бокам, когда список не помещается целиком
  // (запрос пользователя 2026-07-19: "чтобы было видно что есть скроллинг",
  // "самой линии прокрутки не должно быть") — нативный скроллбар скрыт
  // классом scrollbar-none, видимость самого факта скролла обеспечивают
  // стрелки, а не браузерная полоса.
  return (
    <div className="mb-4 flex items-center gap-1 rounded-control bg-card p-1.5 shadow-card-rest">
      {canScrollLeft && (
        <PressableScale className="shrink-0">
          <button
            type="button"
            onClick={() => scrollByAmount(-120)}
            aria-label={t.common.back}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        </PressableScale>
      )}
      <div ref={scrollRef} onScroll={updateScrollState} className="scrollbar-none flex flex-1 gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => onSelect(ALL_CATEGORIES)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-caption-airbnb font-semibold whitespace-nowrap",
            categoryFilter === ALL_CATEGORIES ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          {t.goods.allCategoriesLabel}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-caption-airbnb font-semibold whitespace-nowrap",
              categoryFilter === c.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <PressableScale className="shrink-0">
          <button
            type="button"
            onClick={() => scrollByAmount(120)}
            aria-label={t.common.next}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </PressableScale>
      )}
    </div>
  );
}

// Отложенные заказы — та же схема скролла стрелками, что у CategoryChipsRow
// выше (запрос пользователя 2026-07-30: "скроллинг без полосы, стрелочки по
// бокам как в Категориях товаров"), только "белая плашка" зафиксирована над
// нижним баром (position: fixed), а не в потоке страницы. Время создания —
// второй строкой под номером/названием заказа (тот же запрос, "мелко") —
// formatTime — локальное устройство-время оператора, тот же формат, что и
// везде в проекте.
function HeldOrdersRow({
  orders,
  onSelect,
  t,
}: {
  orders: HeldOrderCtx[];
  onSelect: (order: HeldOrderCtx) => void;
  t: ReturnType<typeof useI18n>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollState();
  }, [orders]);

  function scrollByAmount(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <div
      className="fixed inset-x-4 z-10 flex items-center gap-1 rounded-control bg-card p-1.5 shadow-card-rest"
      style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
    >
      {canScrollLeft && (
        <PressableScale className="shrink-0">
          <button
            type="button"
            onClick={() => scrollByAmount(-120)}
            aria-label={t.common.back}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        </PressableScale>
      )}
      <div ref={scrollRef} onScroll={updateScrollState} className="scrollbar-none flex flex-1 gap-1.5 overflow-x-auto">
        {orders.map((order) => (
          <PressableScale key={order.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect(order)}
              className="flex shrink-0 flex-col items-center justify-center gap-0 rounded-2xl px-3.5 py-1.5 text-white shadow-sm"
              style={{ backgroundColor: COLOR_TAG_PALETTE[(order.number - 1) % COLOR_TAG_PALETTE.length] }}
            >
              <span className="text-sm leading-tight font-bold whitespace-nowrap">
                {order.label || `${t.goods.heldOrderChipLabel} ${order.number}`}
              </span>
              <span className="text-[0.75rem] leading-tight whitespace-nowrap opacity-80">{formatTime(order.createdAt)}</span>
            </button>
          </PressableScale>
        ))}
      </div>
      {canScrollRight && (
        <PressableScale className="shrink-0">
          <button
            type="button"
            onClick={() => scrollByAmount(120)}
            aria-label={t.common.next}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </PressableScale>
      )}
    </div>
  );
}
