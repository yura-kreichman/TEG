"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { PressableScale } from "@/components/motion/pressable-scale";
import { cn } from "@/lib/utils";

export interface BottomGlassNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}

/**
 * Общий "стеклянный" нижний бар (docs/spec/03-design-system.md, НАВИГАЦИЯ) —
 * используется и кабинетом владельца (owner-shell.tsx), и (когда появится)
 * баром PWA оператора: сама разметка/анимации/стекло не зависят от того, чьи
 * конкретно пункты в неё подставляют. Состав и приоритетную логику пунктов
 * решает вызывающий компонент — этот рендерит уже готовый список + "Ещё".
 */
export function BottomGlassNav({
  items,
  moreLabel,
  moreActive,
  moreBadge,
  onMoreClick,
  showMore,
  hideOnDesktop = true,
}: {
  items: BottomGlassNavItem[];
  moreLabel: string;
  moreActive: boolean;
  moreBadge: "red" | "green" | null;
  onMoreClick: () => void;
  // "Ещё" — только когда реально есть что в него убрать (запрос пользователя
  // 2026-07-17: не показывать "Ещё" без переполнения пунктами меню). Решает
  // вызывающий компонент, а не сам бар — у него нет своего списка "лишних"
  // пунктов, только уже готовый items + внешний BottomSheet.
  showMore: boolean;
  // Кабинет владельца на md+ переключается на боковой сайдбар (owner-shell.tsx)
  // — бар должен спрятаться. PWA оператора — терминал на точке (часто
  // планшет, "приспособлен к планшету", запрос пользователя 2026-07-19), у
  // неё нет альтернативной навигации для широких экранов, нижний бар должен
  // остаться виден на любой ширине.
  hideOnDesktop?: boolean;
}) {
  return (
    <nav
      className={cn(
        "nav-glass fixed inset-x-0 bottom-0 flex pb-[env(safe-area-inset-bottom)]",
        hideOnDesktop && "md:hidden"
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <PressableScale key={item.href} className="flex-1">
            <Link
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-xs",
                item.active ? "font-semibold text-primary" : "text-nav-inactive font-medium"
              )}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          </PressableScale>
        );
      })}
      {showMore && (
        <PressableScale className="relative flex-1">
          <button
            type="button"
            onClick={onMoreClick}
            className={cn(
              "flex w-full flex-col items-center gap-0.5 py-2 text-xs",
              moreActive ? "font-semibold text-primary" : "text-nav-inactive font-medium"
            )}
          >
            <span className="relative">
              <MoreHorizontal className="size-5" />
              {moreBadge && (
                <span
                  className={cn(
                    "absolute -right-0.5 -top-0.5 size-2 rounded-full",
                    moreBadge === "red" ? "bg-destructive" : "bg-success"
                  )}
                  style={{ boxShadow: "0 0 0 2px var(--nav-glass-bg)" }}
                />
              )}
            </span>
            {moreLabel}
          </button>
        </PressableScale>
      )}
    </nav>
  );
}
