"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Корзины "Билетов" и "Товаров" на уровне layout (запрос пользователя
// 2026-07-21: "текущее состояние корзины не должно сбрасываться при
// переключении между пунктами меню") — operator/layout.tsx не
// перемонтируется при клиентской навигации между /operator/*, поэтому
// состояние здесь переживает переход на "Товары"/"Клиенты" и обратно.
// Дополнительно persist в localStorage (запрос пользователя 2026-07-21: "при
// обновлении страницы должны сохраняться состояние Корзины") — меняет более
// раннее решение спеки для Билетов (docs/spec/10-tickets.md, "ЗАКАЗ":
// "перезагрузка теряет черновик — осознанно"); теперь корзина переживает и
// полную перезагрузку страницы, для обоих модулей одинаково.

const TICKETS_CART_STORAGE_KEY = "ticketsCartByZone";
const GOODS_CART_STORAGE_KEY = "goodsCart";

export type TicketCart = Record<string, number>;

interface TicketsCartContextValue {
  getCart: (zoneId: string) => TicketCart;
  setQuantity: (zoneId: string, key: string, quantity: number) => void;
  clearCart: (zoneId: string) => void;
}

const TicketsCartContext = createContext<TicketsCartContextValue | null>(null);

export function TicketsCartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Record<string, TicketCart>>({});
  // Первый проход эффекта записи ниже пропускается (запрос пользователя —
  // иначе он записал бы ещё пустое {} НАЧАЛЬНОГО состояния раньше, чем эффект
  // восстановления успеет применить сохранённое значение, затирая его на
  // мгновение — не баг по сути, но лишняя запись, проще не делать её вовсе).
  const isFirstWrite = useRef(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TICKETS_CART_STORAGE_KEY);
      if (raw) setCarts(JSON.parse(raw));
    } catch {
      // Повреждённые данные в localStorage — просто начинаем с пустой корзины.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isFirstWrite.current) {
      isFirstWrite.current = false;
      return;
    }
    window.localStorage.setItem(TICKETS_CART_STORAGE_KEY, JSON.stringify(carts));
  }, [carts]);

  function getCart(zoneId: string): TicketCart {
    return carts[zoneId] ?? {};
  }

  function setQuantity(zoneId: string, key: string, quantity: number) {
    setCarts((prev) => ({
      ...prev,
      [zoneId]: { ...(prev[zoneId] ?? {}), [key]: Math.max(0, quantity) },
    }));
  }

  function clearCart(zoneId: string) {
    setCarts((prev) => ({ ...prev, [zoneId]: {} }));
  }

  return (
    <TicketsCartContext.Provider value={{ getCart, setQuantity, clearCart }}>{children}</TicketsCartContext.Provider>
  );
}

export function useTicketsCart() {
  const ctx = useContext(TicketsCartContext);
  if (!ctx) throw new Error("useTicketsCart must be used within TicketsCartProvider");
  return ctx;
}

// Какой отложенный заказ сейчас поднят в корзину. Раньше жил в состоянии
// страницы "Товары" и терялся при уходе в другой раздел, а сами позиции
// оставались здесь (баг, найден пользователем 2026-09-17): вернувшись,
// оператор видел корзину заказа как свежий черновик, а докупленное в заказ
// не попадало вовсе — и закрытие шторки создало бы второй заказ с теми же
// товарами, списав остаток повторно. Привязка хранится рядом с позициями и
// переживает то же, что и они.
const GOODS_CART_HELD_ORDER_STORAGE_KEY = "goodsCartHeldOrderId";

type GoodsCart = Record<string, number>;

interface GoodsCartContextValue {
  cart: GoodsCart;
  setQuantity: (goodsId: string, quantity: number) => void;
  /** Очищает корзину и снимает привязку к отложенному заказу. */
  clearCart: () => void;
  heldOrderId: string | null;
  /** Актуальная привязка для асинхронных колбэков, чьё замыкание старше последнего рендера. */
  getHeldOrderId: () => string | null;
  /** Поднимает позиции заказа в корзину — их сервер уже знает, повторно не отправляются. */
  openHeldOrder: (orderId: string, quantities: GoodsCart) => void;
  /**
   * Дожидается, пока сервер получит последнее содержимое поднятого заказа
   * (отправляет, если ещё не отправлено). Ошибки уходят подписчикам.
   */
  syncHeldOrder: () => Promise<void>;
  /** message === null — сетевая ошибка, текст подбирает подписчик. */
  subscribeHeldOrderSyncErrors: (listener: (message: string | null) => void) => () => void;
}

const GoodsCartContext = createContext<GoodsCartContextValue | null>(null);

function heldOrderItems(cart: GoodsCart) {
  return Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([goodsId, quantity]) => ({ goodsId, quantity }));
}

export function GoodsCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<GoodsCart>({});
  const [heldOrderId, setHeldOrderId] = useState<string | null>(null);
  const isFirstWrite = useRef(true);

  // Правка поднятого заказа сохраняется на сервер сразу, а не только при
  // закрытии шторки или «Оплатить» (запрос пользователя 2026-09-17): шторка
  // при подъёме заказа не открывается, и уход в другой раздел молча терял
  // докупленное. Синхронизация живёт здесь, а не на странице — страница
  // размонтируется при переходе, провайдер нет.
  //
  // Refs, а не state: цикл отправки переживает рендеры и должен видеть
  // последнее значение, поэтому все записи идут через функции ниже, которые
  // обновляют ref синхронно.
  const cartRef = useRef<GoodsCart>({});
  const heldOrderIdRef = useRef<string | null>(null);
  // Что сервер уже знает о поднятом заказе — пустой PUT не шлём.
  const syncedRef = useRef<{ orderId: string; key: string } | null>(null);
  // Не больше одного PUT за раз: тело — ПОЛНОЕ желаемое содержимое, и два
  // параллельных запроса сервер может применить в обратном порядке, вернув
  // заказ к более старому состоянию. Цикл после каждого ответа перечитывает
  // корзину и досылает, если за время запроса она изменилась.
  const syncRunRef = useRef<Promise<void> | null>(null);
  const errorListenersRef = useRef(new Set<(message: string | null) => void>());

  function writeCart(next: GoodsCart) {
    cartRef.current = next;
    setCart(next);
  }

  function writeHeldOrderId(next: string | null) {
    heldOrderIdRef.current = next;
    setHeldOrderId(next);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GOODS_CART_STORAGE_KEY);
      if (raw) writeCart(JSON.parse(raw));
      const storedHeldOrderId = window.localStorage.getItem(GOODS_CART_HELD_ORDER_STORAGE_KEY);
      if (storedHeldOrderId) writeHeldOrderId(storedHeldOrderId);
    } catch {
      // Повреждённые данные в localStorage — просто начинаем с пустой корзины.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isFirstWrite.current) {
      isFirstWrite.current = false;
      return;
    }
    window.localStorage.setItem(GOODS_CART_STORAGE_KEY, JSON.stringify(cart));
    if (heldOrderId) {
      window.localStorage.setItem(GOODS_CART_HELD_ORDER_STORAGE_KEY, heldOrderId);
    } else {
      window.localStorage.removeItem(GOODS_CART_HELD_ORDER_STORAGE_KEY);
    }
  }, [cart, heldOrderId]);

  function notifySyncError(message: string | null) {
    for (const listener of errorListenersRef.current) listener(message);
  }

  function syncHeldOrder(): Promise<void> {
    if (syncRunRef.current) return syncRunRef.current;
    const run = (async () => {
      for (;;) {
        const orderId = heldOrderIdRef.current;
        const items = heldOrderItems(cartRef.current);
        // Пустую корзину заказа не отправляем: опустошённый заказ удаляется
        // при закрытии шторки (см. operator/goods/page.tsx), а не остаётся
        // пустым на сервере.
        if (!orderId || items.length === 0) return;
        const key = JSON.stringify(items);
        if (syncedRef.current?.orderId === orderId && syncedRef.current.key === key) return;

        let res: Response;
        let data: { error?: string; code?: string };
        try {
          res = await fetch(`/api/operator/goods/held-orders/${orderId}/items`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
          });
          data = await res.json().catch(() => ({}));
        } catch {
          if (heldOrderIdRef.current === orderId) notifySyncError(null);
          return;
        }

        if (!res.ok) {
          // Пока шёл запрос, заказ могли отпустить (оплата, удаление, другой
          // заказ) — тогда ошибка по нему уже никому не интересна.
          if (heldOrderIdRef.current !== orderId) return;
          if (data.code === "ORDER_NOT_FOUND") {
            // Заказ оплатили или удалили на другом устройстве точки: держать
            // его позиции в корзине дальше — значит продать их второй раз.
            writeCart({});
            writeHeldOrderId(null);
            syncedRef.current = null;
          }
          notifySyncError(data.error ?? null);
          return;
        }
        syncedRef.current = { orderId, key };
      }
    })().finally(() => {
      syncRunRef.current = null;
    });
    syncRunRef.current = run;
    return run;
  }

  useEffect(() => {
    if (heldOrderId) void syncHeldOrder();
    // syncHeldOrder читает только refs — пересоздание функции на рендере не
    // должно перезапускать отправку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, heldOrderId]);

  function setQuantity(goodsId: string, quantity: number) {
    writeCart({ ...cartRef.current, [goodsId]: Math.max(0, quantity) });
  }

  function clearCart() {
    writeCart({});
    writeHeldOrderId(null);
    syncedRef.current = null;
  }

  function openHeldOrder(orderId: string, quantities: GoodsCart) {
    syncedRef.current = { orderId, key: JSON.stringify(heldOrderItems(quantities)) };
    writeCart(quantities);
    writeHeldOrderId(orderId);
  }

  function subscribeHeldOrderSyncErrors(listener: (message: string | null) => void) {
    errorListenersRef.current.add(listener);
    return () => {
      errorListenersRef.current.delete(listener);
    };
  }

  return (
    <GoodsCartContext.Provider
      value={{
        cart,
        setQuantity,
        clearCart,
        heldOrderId,
        getHeldOrderId: () => heldOrderIdRef.current,
        openHeldOrder,
        syncHeldOrder,
        subscribeHeldOrderSyncErrors,
      }}
    >
      {children}
    </GoodsCartContext.Provider>
  );
}

export function useGoodsCart() {
  const ctx = useContext(GoodsCartContext);
  if (!ctx) throw new Error("useGoodsCart must be used within GoodsCartProvider");
  return ctx;
}
