"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ClockPlus, Home, ShoppingBag, Ticket, Timer, Wallet } from "lucide-react";
import { BottomGlassNav, type BottomGlassNavItem } from "@/components/bottom-glass-nav";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { isLaunchesZone, isStaysZone, isTicketsZone } from "@/lib/results-calc";
import { unlockBeep, playBeep } from "@/lib/beep";
import { cn } from "@/lib/utils";

const EXPIRY_POLL_MS = 6000;
// Повторяющийся сигнал, пока хоть один пуск "За вход" не закрыт (запрос
// пользователя 2026-07-17: "звукового непрерывного уведомления", позже
// "должно быть громче и чаще" — было 20000, слишком редко на реальной точке).
const EXPIRY_ALERT_REPEAT_MS = 8000;

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
  const router = useRouter();
  const t = useI18n();
  const [hasStays, setHasStays] = useState(false);
  const [hasLaunches, setHasLaunches] = useState(false);
  const [hasTickets, setHasTickets] = useState(false);
  const [hasGoods, setHasGoods] = useState(false);
  const [hasZones, setHasZones] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const zones = data.zones ?? [];
        setHasStays(zones.some(isStaysZone));
        setHasLaunches(zones.some(isLaunchesZone));
        // Доступна оператору с доступом к зоне вообще, не только с
        // тумблером "Продажа билетов" (докс: "гашение доступно без него") —
        // сам тумблер гейтит только вкладку "Продать" внутри экрана.
        setHasTickets(zones.some(isTicketsZone));
        setHasGoods(Boolean(data.goodsAccess));
        // Абонемент применим как способ оплаты на ЛЮБОЙ зоне (запрос
        // пользователя 2026-07-20: "актуально не только для счётчиков, но и
        // Только касса" — расширил ранее stays/launches-only список до всех
        // 4 режимов учёта), поэтому "Клиенты" теперь зависит просто от
        // наличия хоть одной зоны, а не конкретного режима.
        setHasZones(zones.length > 0);
      })
      .catch(() => {});
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hidden = pathname === "/operator/login" || pathname.startsWith("/operator/submit");

  // Глобальное напоминание о пусках "За вход", у которых истекает/истёк
  // таймер (запрос пользователя 2026-07-17) — опрашивается независимо от
  // текущего экрана, пока нижний бар вообще виден (скрыт только на входе и
  // в мастере сдачи итогов, там и так не до напоминаний).
  const [expiredCount, setExpiredCount] = useState(0);
  const [expiredAssetId, setExpiredAssetId] = useState<string | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (hidden || !hasStays) {
      setExpiredCount(0);
      setExpiredAssetId(null);
      return;
    }
    function checkExpired() {
      fetch("/api/operator/expired-launches")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          setExpiredCount(data.count ?? 0);
          setExpiredAssetId(data.firstAssetId ?? null);
        })
        .catch(() => {});
    }
    checkExpired();
    const interval = setInterval(checkExpired, EXPIRY_POLL_MS);
    return () => clearInterval(interval);
  }, [hidden, hasStays]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Звук+вибрация сразу при обнаружении, затем повтор, пока не закрыты —
  // завязано на переход 0 -> >0 (не на каждое изменение count), чтобы не
  // перезапускать таймер повтора при появлении/уходе других пусков.
  useEffect(() => {
    if (expiredCount === 0) {
      if (alertTimerRef.current) {
        clearInterval(alertTimerRef.current);
        alertTimerRef.current = null;
      }
      return;
    }
    playBeep();
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    alertTimerRef.current = setInterval(() => {
      playBeep();
      if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    }, EXPIRY_ALERT_REPEAT_MS);
    return () => {
      if (alertTimerRef.current) clearInterval(alertTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiredCount > 0]);

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
            icon: Timer,
            active: pathname.startsWith("/operator/game-room"),
          },
        ]
      : []),
    ...(hasLaunches
      ? [
          {
            href: "/operator/launches",
            label: t.zonesList.accountingModeLaunches,
            icon: ClockPlus,
            active: pathname.startsWith("/operator/launches"),
          },
        ]
      : []),
    ...(hasTickets
      ? [
          {
            href: "/operator/tickets",
            label: t.zonesList.accountingModeTickets,
            icon: Ticket,
            active: pathname.startsWith("/operator/tickets"),
          },
        ]
      : []),
    // "Товары" (docs/spec/09-goods.md, "Доступ") — рендерится только с
    // тумблером goodsAccess, тот же принцип, что у Прибываний/Пусков выше
    // (модуль без доступа не рендерится вовсе, не показывается заблокированным).
    // Перед "Клиенты" (запрос пользователя 2026-07-19).
    ...(hasGoods
      ? [
          {
            href: "/operator/goods",
            label: t.goods.navLabel,
            icon: ShoppingBag,
            active: pathname.startsWith("/operator/goods"),
          },
        ]
      : []),
    // "Абоненты" — только если у оператора есть хоть одна зона (запрос
    // пользователя 2026-07-17: "если у него активные зоны, где абонимент
    // применяется" — изначально это были только "Прибывания"/"Пуски", но
    // 2026-07-20 абонемент стал применим и на "Счётчиках"/"Только касса" —
    // фактически на любом режиме, поэтому условие теперь просто "есть хоть
    // одна зона", не конкретный режим). Ярлык — "Абоненты", не "Абонементы"
    // (запрос пользователя 2026-07-18: "Абоненты у нас кошелёчки,
    // Абонементы — подарочки" — у Сотрудника этот экран только про кошельки
    // клиентов, тарифами он не управляет, поэтому и название, и иконка — те
    // же, что у секции "Абоненты" в кабинете владельца, не общее название
    // модуля).
    ...(hasZones
      ? [
          {
            href: "/operator/abonements",
            label: t.abonements.walletsTitle,
            icon: Wallet,
            active: pathname.startsWith("/operator/abonements"),
          },
        ]
      : []),
  ];

  return (
    <div
      className="flex flex-1 flex-col"
      onPointerDownCapture={() => unlockBeep()}
    >
      <div
        className={cn(
          "flex flex-1 flex-col",
          !hidden && "pb-[calc(4rem+env(safe-area-inset-bottom))]",
          !hidden && expiredCount > 0 && "pb-[calc(6.75rem+env(safe-area-inset-bottom))]"
        )}
      >
        {children}
      </div>
      {!hidden && expiredCount > 0 && (
        <PressableScale
          className="fixed inset-x-0 z-40 px-3"
          style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={() => router.push(`/operator/game-room${expiredAssetId ? `?assetId=${expiredAssetId}` : ""}`)}
            className="mx-auto flex w-full max-w-md items-center gap-2 rounded-control border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-left shadow-floating motion-safe:animate-pulse md:max-w-xl lg:max-w-2xl"
          >
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span className="flex-1 truncate text-caption-airbnb font-bold text-destructive">
              {t.operatorApp.gameRoom.expiredBannerLabel}
            </span>
            <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[0.6875rem] font-bold text-white tabular-nums">
              {expiredCount}
            </span>
          </button>
        </PressableScale>
      )}
      {!hidden && (
        <BottomGlassNav
          items={items}
          moreLabel={t.nav.more}
          moreActive={false}
          moreBadge={null}
          onMoreClick={() => {}}
          showMore={false}
          hideOnDesktop={false}
        />
      )}
    </div>
  );
}
