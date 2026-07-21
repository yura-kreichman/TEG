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

interface GoodsCartContextValue {
  cart: Record<string, number>;
  setQuantity: (goodsId: string, quantity: number) => void;
  clearCart: () => void;
}

const GoodsCartContext = createContext<GoodsCartContextValue | null>(null);

export function GoodsCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const isFirstWrite = useRef(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GOODS_CART_STORAGE_KEY);
      if (raw) setCart(JSON.parse(raw));
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
  }, [cart]);

  function setQuantity(goodsId: string, quantity: number) {
    setCart((prev) => ({ ...prev, [goodsId]: Math.max(0, quantity) }));
  }

  function clearCart() {
    setCart({});
  }

  return <GoodsCartContext.Provider value={{ cart, setQuantity, clearCart }}>{children}</GoodsCartContext.Provider>;
}

export function useGoodsCart() {
  const ctx = useContext(GoodsCartContext);
  if (!ctx) throw new Error("useGoodsCart must be used within GoodsCartProvider");
  return ctx;
}
