"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Корзины "Билетов" и "Товаров" на уровне layout (запрос пользователя
// 2026-07-21: "текущее состояние корзины не должно сбрасываться при
// переключении между пунктами меню") — operator/layout.tsx не
// перемонтируется при клиентской навигации между /operator/*, поэтому
// состояние здесь переживает переход на "Товары"/"Клиенты" и обратно. При
// полной перезагрузке страницы контекст создаётся заново — черновик теряется,
// это осознанное поведение и для Билетов (docs/spec/10-tickets.md, "ЗАКАЗ":
// "перезагрузка теряет черновик — осознанно"), и для Товаров (тот же
// принцип, единообразно).

export type TicketCart = Record<string, number>;

interface TicketsCartContextValue {
  getCart: (zoneId: string) => TicketCart;
  setQuantity: (zoneId: string, key: string, quantity: number) => void;
  clearCart: (zoneId: string) => void;
}

const TicketsCartContext = createContext<TicketsCartContextValue | null>(null);

export function TicketsCartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Record<string, TicketCart>>({});

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
