"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Home, ListChecks, Watch } from "lucide-react";
import { BottomGlassNav, type BottomGlassNavItem } from "@/components/bottom-glass-nav";
import { useI18n } from "@/components/i18n-provider";
import { isLaunchesZone, isStaysZone } from "@/lib/results-calc";
import { cn } from "@/lib/utils";

/**
 * Нижний бар PWA оператора (docs/spec/03-design-system.md, "Навигация":
 * "PWA оператора: нижняя панель вкладок... Внутри мастера сдачи итогов
 * нижняя навигация скрыта — только Назад/Далее мастера"). Скрыт также на
 * экране входа (оператор ещё не аутентифицирован, переходить некуда).
 * Резервирует нижний padding у контента ровно на высоту бара, когда виден —
 * контент должен прокручиваться ПОД баром, а не под ним прятаться.
 *
 * Первый пункт — "Главная" (запрос пользователя 2026-07-17), всегда виден.
 * Дальше — "Прибывания", затем "Пуски" (тот же день: "тоже был он в
 * нижнем баре"), каждый рендерится только если у оператора вообще есть
 * доступная зона такого режима (выключенный модуль не рендерится,
 * docs/spec/03-design-system.md). Подписи — те же строки, что и режим учёта
 * в кабинете владельца (t.zonesList.accountingMode*), а не отдельные
 * переводы — запрос пользователя того же дня: "единообразный интерфейс и
 * терминология".
 */
export function OperatorBottomNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useI18n();
  const [hasStays, setHasStays] = useState(false);
  const [hasLaunches, setHasLaunches] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const zones = data.zones ?? [];
        setHasStays(zones.some(isStaysZone));
        setHasLaunches(zones.some(isLaunchesZone));
      })
      .catch(() => {});
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hidden = pathname === "/operator/login" || pathname.startsWith("/operator/submit");

  const items: BottomGlassNavItem[] = [
    {
      href: "/operator",
      label: t.nav.home,
      icon: Home,
      active: pathname === "/operator",
    },
    ...(hasStays
      ? [
          {
            href: "/operator/game-room",
            label: t.zonesList.accountingModeStays,
            icon: Watch,
            active: pathname.startsWith("/operator/game-room"),
          },
        ]
      : []),
    ...(hasLaunches
      ? [
          {
            href: "/operator/launches",
            label: t.zonesList.accountingModeLaunches,
            icon: ListChecks,
            active: pathname.startsWith("/operator/launches"),
          },
        ]
      : []),
  ];

  return (
    <>
      <div className={cn("flex flex-1 flex-col", !hidden && "pb-[calc(4rem+env(safe-area-inset-bottom))]")}>
        {children}
      </div>
      {!hidden && (
        <BottomGlassNav
          items={items}
          moreLabel={t.nav.more}
          moreActive={false}
          moreBadge={null}
          onMoreClick={() => {}}
          showMore={false}
        />
      )}
    </>
  );
}
