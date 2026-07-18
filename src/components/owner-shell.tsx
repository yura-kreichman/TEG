"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, FileText, Globe, Home, ListChecks, MapPin, Settings, Users, Wallet, type LucideIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/components/i18n-provider";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { BottomGlassNav, type BottomGlassNavItem } from "@/components/bottom-glass-nav";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { useTextScale, textScaleZoom } from "@/components/text-scale-provider";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n";

interface NavItemConfig {
  id: string;
  href: string;
  icon: LucideIcon;
  label: (t: Dictionary) => string;
  // Приоритет заполнения слотов бара (docs/spec/00-architecture.md,
  // "Навигация") — меньше число, выше приоритет. Первые 4 занимают слоты
  // бара, остальные — в "Ещё". Модули больше не гейтятся (во всех пакетах
  // работают все модули, разница только в числовых лимитах — фидбек
  // пользователя 2026-07-12), поэтому все пункты ниже всегда доступны.
  priority: number;
  match: (pathname: string) => boolean;
}

const BAR_SLOTS = 4;

const PRIORITY_ITEMS: NavItemConfig[] = [
  // "/" не может быть startsWith (это дало бы true для абсолютно любого пути) —
  // единственный пункт с точным совпадением. У остальных есть под-страницы
  // (/money/readings, /reports/[pointId], /operators/[id], /points/[id]),
  // поэтому startsWith — иначе активная подсветка пропадает на них, как и
  // пропадала для "Отчёты" (найдено 2026-07-11).
  { id: "home", href: "/", icon: Home, label: (t) => t.nav.home, priority: 1, match: (p) => p === "/" },
  { id: "money", href: "/money", icon: Wallet, label: (t) => t.nav.money, priority: 2, match: (p) => p.startsWith("/money") },
  { id: "reports", href: "/reports", icon: BarChart3, label: (t) => t.nav.reports, priority: 3, match: (p) => p.startsWith("/reports") },
  { id: "operators", href: "/operators", icon: Users, label: (t) => t.nav.operators, priority: 4, match: (p) => p.startsWith("/operators") },
  { id: "tasks", href: "/tasks", icon: ListChecks, label: (t) => t.nav.tasks, priority: 5, match: (p) => p.startsWith("/tasks") },
  // Модуль "Абонементы" (запрос пользователя 2026-07-17) — управление
  // пакетами пополнения и списком кошельков клиентов, отдельный пункт меню
  // ("Там он будет управлять ими: создавать новые/редактировать/удалять"),
  // не вложен в "Настройки" — тот же уровень, что у Инструктажей/Лендинга.
  // Сразу после "Задачи" (решение пользователя 2026-07-17).
  {
    id: "abonements",
    href: "/abonements",
    icon: Wallet,
    // "Абоненты", не "Абонементы" (запрос пользователя 2026-07-18) — тот же
    // ярлык, что у Сотрудника (t.abonements.walletsTitle), для единообразия;
    // страница внутри всё равно называется "Абонементы" и содержит оба таба.
    label: (t) => t.abonements.walletsTitle,
    priority: 6,
    match: (p) => p.startsWith("/abonements"),
  },
  { id: "points", href: "/points", icon: MapPin, label: (t) => t.nav.points, priority: 7, match: (p) => p.startsWith("/points") },
  // Полноценный модуль (docs/spec/07-instructions.md), не тенантная
  // настройка — вынесен из вложенности Ещё → Настройки → Инструктажи прямо
  // в "Ещё", перед Настройками (решение пользователя 2026-07-12).
  {
    id: "instructions",
    href: "/settings/instructions",
    icon: FileText,
    label: (t) => t.instructions.settingsTitle,
    priority: 8,
    match: (p) => p.startsWith("/settings/instructions"),
  },
  // Полноценный модуль (docs/spec/08-landing.md) — тот же паттерн, что у
  // Инструктажей: в "Ещё", не в bottom nav.
  {
    id: "landing",
    href: "/settings/landing",
    icon: Globe,
    label: (t) => t.landing.settingsTitle,
    priority: 9,
    match: (p) => p.startsWith("/settings/landing"),
  },
];

// "Настройки" никогда не конкурирует за слот бара — всегда в "Ещё"
// (docs/spec/00-architecture.md).
const SETTINGS_ITEM: NavItemConfig = {
  id: "settings",
  href: "/settings",
  icon: Settings,
  label: (t) => t.nav.settings,
  priority: Infinity,
  match: (p) => p === "/settings",
};

/**
 * Owner cabinet shell (docs/spec/00-architecture.md + 03-design-system.md,
 * "Навигация"): сайдбар на десктопе, "стеклянный" bottom nav на мобильном.
 * Состав бара — данными (id/иконка/приоритет/feature flag), не хардкодом:
 * первые 4 доступных пункта по приоритету занимают слоты, остальные вместе с
 * Настройками уходят в "Ещё". Тот же список используется в desktop-сайдбаре
 * (просто без bottom-sheet — там нет ограничения по ширине).
 */
export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useI18n();
  const { scale } = useTextScale();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingTodoCount, setPendingTodoCount] = useState(0);
  const [pendingDoingCount, setPendingDoingCount] = useState(0);

  // Обновляем при каждой навигации — самый дешёвый способ не держать
  // отдельный стор ради одного badge-числа (список пунктов бара маленький,
  // повторный fetch копеечный).
  useEffect(() => {
    fetch("/api/tasks/pending-count")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setPendingTodoCount(data.todoCount ?? 0);
          setPendingDoingCount(data.doingCount ?? 0);
        }
      });
  }, [pathname]);

  const available = [...PRIORITY_ITEMS].sort((a, b) => a.priority - b.priority);
  const barItems = available.slice(0, BAR_SLOTS);
  const overflowItems = available.slice(BAR_SLOTS);
  const moreItems = [...overflowItems, SETTINGS_ITEM];

  // Badge на "Ещё" — только если что-то реально требующее внимания лежит
  // ИМЕННО внутри "Ещё" сейчас (docs/spec/03-design-system.md): если "Задачи"
  // поместились в сам бар, badge не показываем — там уже видно активную
  // вкладку без надобности через "Ещё". Цвет (запрос пользователя
  // 2026-07-17): красная — есть новая (todo) задача, зелёная — есть только
  // "в работе" (doing), нет вовсе — все задачи выполнены.
  const tasksInMore = overflowItems.some((item) => item.id === "tasks");
  const moreBadge: "red" | "green" | null = !tasksInMore
    ? null
    : pendingTodoCount > 0
      ? "red"
      : pendingDoingCount > 0
        ? "green"
        : null;

  const sidebarLink = (item: NavItemConfig) => {
    const Icon = item.icon;
    const active = item.match(pathname);
    return (
      <PressableScale key={item.href}>
        <Link
          href={item.href}
          className={cn(
            "flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium transition-colors",
            active ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5"
          )}
        >
          <Icon className="size-4" />
          {item.label(t)}
        </Link>
      </PressableScale>
    );
  };

  const bottomNavItems: BottomGlassNavItem[] = barItems.map((item) => ({
    href: item.href,
    label: item.label(t),
    icon: item.icon,
    active: item.match(pathname),
  }));

  return (
    // zoom, не transform: scale() — transform создаёт новый containing
    // block для position: fixed, из-за чего bottom-sheet/bottom-nav (fixed
    // относительно вьюпорта) съехали бы вместе с масштабированным деревом.
    // zoom ведёт себя как настоящий зум браузера и сохраняет fixed-позиционирование.
    <div className="flex min-h-full flex-1 flex-col md:flex-row" style={{ zoom: textScaleZoom(scale) }}>
      <ImpersonationBanner />
      <SubscriptionBanner />
      <aside className="hidden shrink-0 flex-col justify-between bg-surface-0 p-4 md:flex md:w-56">
        <nav className="flex flex-col gap-1">
          {barItems.map(sidebarLink)}
          <div className="my-1 border-t border-border" />
          {moreItems.map(sidebarLink)}
        </nav>
        <ThemeToggle />
      </aside>

      <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</div>

      <BottomGlassNav
        items={bottomNavItems}
        moreLabel={t.nav.more}
        moreActive={moreItems.some((item) => item.match(pathname))}
        moreBadge={moreBadge}
        onMoreClick={() => setMoreOpen(true)}
        showMore={moreItems.length > 0}
      />

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <div className="flex flex-col pt-2">
          <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.nav.more}</h2>
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 border-t border-border py-3.5 text-left text-body-airbnb first:border-t-0"
              >
                <Icon className="size-4 shrink-0" />
                {item.label(t)}
                {item.id === "tasks" && moreBadge && (
                  <span
                    className={cn(
                      "ml-auto size-2 shrink-0 rounded-full",
                      moreBadge === "red" ? "bg-destructive" : "bg-success"
                    )}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}
