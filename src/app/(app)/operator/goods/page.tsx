"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { useGoodsCart } from "@/components/operator-cart-context";
import { Money } from "@/components/money";
import { PrintButton } from "@/components/print/print-button";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useOperatorPrintAvailable } from "@/hooks/use-print";
import type { PrintDocumentData } from "@/lib/print/receipt-document";
import { formatMoneyWithCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  // Модуль печати (запрос пользователя 2026-07-20) — квитанция по факту,
  // кнопка появляется в маленьком sheet сразу после успешной продажи,
  // никогда не печатается автоматически (оператор каждый раз решает сам).
  // Теперь несколько позиций за раз (корзина), не одна.
  const [lastOrder, setLastOrder] = useState<{
    items: { goodsName: string; quantity: number; price: number; amount: number }[];
    total: number;
    paymentMethod: "cash" | "mobile" | "abonement";
  } | null>(null);
  const printAvailable = useOperatorPrintAvailable();

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionCategory, setRevisionCategory] = useState<string | null>(null);
  const [revisionQuantities, setRevisionQuantities] = useState<Record<string, string>>({});
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, Record<string, string>>>({});
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const { saved: revisionSaved, pulse: revisionPulse } = useSavePulse();

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcilePending, setReconcilePending] = useState<{ cash: number; mobile: number; abonement: number } | null>(
    null
  );
  const [reconcileCash, setReconcileCash] = useState("");
  const [reconcileMobile, setReconcileMobile] = useState("");
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
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
      .catch(() => setError(t.operatorApp.gameRoom.networkError))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function sellCart(paymentMethod: "cash" | "mobile" | "abonement", walletId?: string) {
    if (currentCartLines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/operator/goods/sale/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: currentCartLines.map((l) => ({ goodsId: l.goodsId, quantity: l.quantity })),
          paymentMethod,
          walletId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      if (printAvailable.available) {
        setLastOrder({
          items: currentCartLines.map((l) => ({
            goodsName: l.name,
            quantity: l.quantity,
            price: l.price,
            amount: l.price * l.quantity,
          })),
          total: data.total,
          paymentMethod,
        });
      }
      goodsCart.clearCart();
      setCartSheetOpen(false);
      setPaymentOpen(false);
      setAbonementTarget(null);
      load();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

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
            { label: t.goods.receiptPaymentMethodLabel, value: paymentMethodLabel[order.paymentMethod] },
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
    setRevisionError(null);
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
      setRevisionError(t.goods.noTrackedGoods);
      return;
    }
    setRevisionSubmitting(true);
    setRevisionError(null);
    try {
      const res = await fetch("/api/operator/goods/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRevisionError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      load();
      revisionPulse(() => {
        setRevisionDrafts({});
        setRevisionOpen(false);
      });
    } catch {
      setRevisionError(t.operatorApp.gameRoom.networkError);
    } finally {
      setRevisionSubmitting(false);
    }
  }

  function openReconcile() {
    setReconcileCash("");
    setReconcileMobile("");
    setReconcileError(null);
    setReconcilePending(null);
    setReconcileOpen(true);
    fetch("/api/operator/goods/reconciliations")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setReconcilePending(data.pending))
      .catch(() => setReconcileError(t.operatorApp.gameRoom.networkError));
  }

  async function saveReconciliation() {
    const actualCash = Number(reconcileCash || "0");
    const actualMobile = Number(reconcileMobile || "0");
    if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) return;
    setReconcileSubmitting(true);
    setReconcileError(null);
    try {
      const res = await fetch("/api/operator/goods/reconciliations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualCash, actualMobile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReconcileError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      reconcilePulse(() => setReconcileOpen(false));
    } catch {
      setReconcileError(t.operatorApp.gameRoom.networkError);
    } finally {
      setReconcileSubmitting(false);
    }
  }

  const reconcileDifference =
    reconcilePending && (reconcileCash || reconcileMobile)
      ? Number(reconcileCash || "0") + Number(reconcileMobile || "0") - reconcilePending.cash - reconcilePending.mobile
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
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                >
                  <ClipboardList className="size-5" />
                </button>
              </PressableScale>
            )}
            {/* Корзина — та же иконка-кнопка, что у Билетов (запрос
                пользователя 2026-07-21: "такой же принцип корзины"), всегда
                видна, серая пока пуста. */}
            <PressableScale>
              <button
                type="button"
                onClick={() => cartCount > 0 && setCartSheetOpen(true)}
                disabled={cartCount === 0}
                aria-label={t.tickets.cartTitle}
                className={cn(
                  "relative flex size-10 shrink-0 items-center justify-center rounded-full",
                  cartCount > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
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
                    className="flex w-full flex-col overflow-hidden rounded-card border-[1.5px] border-border bg-card text-left disabled:opacity-40"
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
                      <span className="truncate text-[0.8125rem] font-bold leading-tight tracking-[-0.01em]">{g.name}</span>
                      <span className="truncate tabular-nums text-[0.75rem] font-semibold leading-tight text-primary">
                        <Money value={g.price} />
                      </span>
                    </div>
                  </button>
                </PressableScale>
              );
            })}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {/* Корзина — позиции со степперами (тот же принцип, что у Билетов,
          запрос пользователя 2026-07-21), минус на 1 убирает строку целиком. */}
      <BottomSheet open={cartSheetOpen} onClose={() => setCartSheetOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.tickets.cartTitle}</h2>
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
              <div className="flex items-stretch gap-2">
                <PressableScale className="flex flex-1">
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
                {/* Очистить корзину целиком — через "Точно?" (запрос
                    пользователя 2026-07-21), тот же ConfirmButton, что и
                    везде по проекту для необратимых действий. */}
                <ConfirmButton
                  className="h-12 shrink-0 px-3.5 text-destructive"
                  onConfirm={() => {
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

      <BottomSheet open={paymentOpen} onClose={() => setPaymentOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.paymentMethodTitle}</h2>
          <div className="flex flex-col gap-2">
            <ConfirmButton className="relative h-12 w-full font-semibold" disabled={submitting} onConfirm={() => sellCart("cash")}>
              <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.cashLabel}
            </ConfirmButton>
            <ConfirmButton
              className="relative h-12 w-full font-semibold"
              disabled={submitting}
              onConfirm={() => sellCart("mobile")}
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
        onConfirm={(walletId) => sellCart("abonement", walletId)}
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
              {revisionError && <p className="text-sm text-destructive">{revisionError}</p>}
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
              {/* Тот же паттерн, что карточка актива в "Сдать итоги"
                  (запрос пользователя 2026-07-19: "по аналогии как с
                  Активами, единообразный интерфейс") — расчётная сумма
                  крупно слева, разбивка по способам оплаты справа. */}
              <div className="flex items-start justify-between gap-2 rounded-control bg-muted p-3.5">
                <div className="flex min-w-0 flex-col tabular-nums">
                  <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.submit.calculatedRevenue}</span>
                  <span className="text-xl font-extrabold leading-none tracking-[-0.02em]">
                    <Money value={reconcilePending.cash + reconcilePending.mobile + reconcilePending.abonement} />
                  </span>
                </div>
                <div className="flex min-w-0 flex-col items-end gap-0.5 pt-1 text-right text-caption-airbnb tabular-nums">
                  <span>
                    {t.operatorApp.submit.cashLabel}:{" "}
                    <span className="font-bold text-foreground">
                      <Money value={reconcilePending.cash} />
                    </span>
                  </span>
                  <span>
                    {t.operatorApp.submit.mobileLabel}:{" "}
                    <span className="font-bold text-foreground">
                      <Money value={reconcilePending.mobile} />
                    </span>
                  </span>
                  {reconcilePending.abonement > 0 && (
                    <span>
                      {t.operatorApp.abonement.paymentLabel}:{" "}
                      <span className="font-bold text-foreground">
                        <Money value={reconcilePending.abonement} />
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-stretch gap-2">
                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="reconcileCash">{t.operatorApp.submit.cashLabel}</Label>
                    <MoneyInput
                      id="reconcileCash"
                      autoFocus
                      scale="lg"
                      inputMode="numeric"
                      className="h-14 rounded-control bg-muted text-lg font-bold"
                      value={reconcileCash}
                      onChange={(e) => setReconcileCash(e.target.value.replace(/[^\d.]/g, ""))}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="reconcileMobile">{t.operatorApp.submit.mobileLabel}</Label>
                    <MoneyInput
                      id="reconcileMobile"
                      scale="lg"
                      inputMode="numeric"
                      className="h-14 rounded-control bg-muted text-lg font-bold"
                      value={reconcileMobile}
                      onChange={(e) => setReconcileMobile(e.target.value.replace(/[^\d.]/g, ""))}
                    />
                  </div>
                </div>
                <PressableScale className="flex">
                  <SaveButton
                    className="h-full min-w-22 rounded-control px-5 font-bold"
                    saved={reconcileSaved}
                    disabled={reconcileSubmitting}
                    onClick={saveReconciliation}
                  />
                </PressableScale>
              </div>

              {reconcileDifference !== null && (
                <p
                  className={cn(
                    "text-caption-airbnb font-semibold tabular-nums",
                    reconcileDifference === 0 ? "text-primary" : "text-warning"
                  )}
                >
                  {t.operatorApp.submit.difference} {reconcileDifference > 0 ? "+" : ""}
                  <Money value={reconcileDifference} />
                </p>
              )}

              {reconcileError && <p className="text-sm text-destructive">{reconcileError}</p>}
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
