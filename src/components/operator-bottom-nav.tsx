"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, CircuitBoard, ClockPlus, Home, ShoppingBag, Ticket, Timer, Wallet } from "lucide-react";
import { BottomGlassNav, type BottomGlassNavItem } from "@/components/bottom-glass-nav";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { isCountersZone, isLaunchesZone, isStaysZone, isTicketsZone } from "@/lib/results-calc";
import { unlockBeep, playBeep } from "@/lib/beep";
import { useLiveRefetch } from "@/hooks/use-live-refetch";
import { useGoodsCart } from "@/components/operator-cart-context";
import { cn } from "@/lib/utils";

const EXPIRY_POLL_MS = 6000;
// Повторяющийся сигнал, пока хоть один пуск "За вход" не закрыт (запрос
// пользователя 2026-07-17: "звукового непрерывного уведомления", позже
// "должно быть громче и чаще" — было 20000, слишком редко на реальной точке).
const EXPIRY_ALERT_REPEAT_MS = 8000;
// "Ещё" при 5+ пунктах (запрос пользователя 2026-07-21) — тот же слот-лимит
// и тот же паттерн (первые N прямо в баре, остальное — в BottomSheet), что
// уже есть у Владельца (owner-shell.tsx, BAR_SLOTS).
const BAR_SLOTS = 4;
// На md+ (планшет/широкий экран, запрос пользователя 2026-07-28: "на
// мобильных как есть, на планшете и широких экранах адаптировался") —
// слотов достаточно под ВСЕ возможные пункты бара разом (Главная +
// Счётчики/Прибывания/Пуски/Билеты/Товары/Абоненты = максимум 7), "Ещё"
// в таком случае не появляется вовсе. Тот же порог md (768px), что и у
// сайдбара Владельца (owner-shell.tsx).
const BAR_SLOTS_WIDE = 7;
const WIDE_MEDIA_QUERY = "(min-width: 768px)";

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
  const [hasCounters, setHasCounters] = useState(false);
  const [hasStays, setHasStays] = useState(false);
  const [hasLaunches, setHasLaunches] = useState(false);
  const [hasTickets, setHasTickets] = useState(false);
  const [hasGoods, setHasGoods] = useState(false);
  const [hasZones, setHasZones] = useState(false);
  // Зелёная точка на "Товары" — не только у непустой корзины-черновика
  // (goodsCartHasItems ниже), но и пока есть хоть один открытый
  // отложенный заказ (запрос пользователя 2026-07-30: "как когда в
  // Корзине есть товары, если есть неоплаченные заказы") — деньги за
  // такой заказ ещё не собраны, тот же сигнал "тут есть незакрытое дело".
  const [hasOpenHeldOrders, setHasOpenHeldOrders] = useState(false);
  // Адаптивное число слотов бара (запрос пользователя 2026-07-28) — SSR и
  // первый клиентский рендер всегда false (совпадают, гидратация без
  // рассинхрона), реальная ширина подставляется эффектом ниже, тем же
  // приёмом, что и остальные локальные "своё на устройство" состояния в
  // проекте (см. use-print.ts).
  const [isWide, setIsWide] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const mq = window.matchMedia(WIDE_MEDIA_QUERY);
    setIsWide(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Зелёная точка на "Товары" (запрос пользователя 2026-07-28, "как в
  // задачах") — корзина не пуста (хоть один товар с количеством > 0) ИЛИ
  // (запрос 2026-07-30) есть открытый отложенный заказ, см. hasOpenHeldOrders.
  const goodsCart = useGoodsCart();
  const goodsCartHasItems = Object.values(goodsCart.cart).some((qty) => qty > 0);
  const [moreOpen, setMoreOpen] = useState(false);

  function loadSubmissionContext() {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const zones = data.zones ?? [];
        setHasCounters(zones.some(isCountersZone));
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
        setHasZones(zones.length > 0 && data.clientsEnabled !== false);
      })
      .catch(() => {});
  }

  function loadHeldOrdersFlag() {
    if (!hasGoods) return;
    fetch("/api/operator/goods/held-orders")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setHasOpenHeldOrders((data.orders ?? []).length > 0);
      })
      .catch(() => {});
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadSubmissionContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Держит состав нижнего бара свежим, пока устройство-терминал часами не
  // покидает этот экран (запрос пользователя 2026-07-22) — если Владелец
  // снял доступ к зоне/тумблер продажи, пункт бара должен пропасть без
  // перезахода.
  useLiveRefetch(loadSubmissionContext);
  // Отдельный from — hasGoods известен только ПОСЛЕ первого ответа
  // loadSubmissionContext выше (та же гонка, что и у остальных пунктов
  // бара), поэтому не в одном useEffect с ним.
  useEffect(() => {
    loadHeldOrdersFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGoods]);
  useLiveRefetch(loadHeldOrdersFlag);

  const hidden = pathname === "/operator/login" || pathname.startsWith("/operator/submit");

  // Глобальное напоминание о пусках "За вход", у которых истекает/истёк
  // таймер (запрос пользователя 2026-07-17) — опрашивается независимо от
  // текущего экрана, пока нижний бар вообще виден (скрыт только на входе и
  // в мастере сдачи итогов, там и так не до напоминаний).
  const [expiredCount, setExpiredCount] = useState(0);
  const [expiredAssetId, setExpiredAssetId] = useState<string | null>(null);
  // Куда вести по тапу на баннер — "Прибывания" или "Пуски" (запрос
  // пользователя 2026-07-28: та же таймерная механика "За вход" появилась и
  // у "Пусков", у них разные экраны).
  const [expiredZoneMode, setExpiredZoneMode] = useState<"stays" | "launches" | null>(null);
  // Уже реально просрочен (не просто приближается) — баннер показывает
  // другой текст (запрос пользователя 2026-07-28: "сообщение 'Истекает
  // таймер' даже если таймер уже истёк" — надо различать).
  const [expiredAlready, setExpiredAlready] = useState(false);
  // Название актива — при двух одновременно истекающих таймерах (например
  // один в "Прибываниях", другой в "Пусках") общий баннер на всю точку не
  // давал понять, к какому именно активу идти (реальная жалоба пользователя
  // 2026-07-28) — теперь называем конкретный.
  const [expiredAssetName, setExpiredAssetName] = useState<string | null>(null);
  const [expiredZoneName, setExpiredZoneName] = useState<string | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (hidden || (!hasStays && !hasLaunches)) {
      setExpiredCount(0);
      setExpiredAssetId(null);
      setExpiredZoneMode(null);
      setExpiredAlready(false);
      setExpiredAssetName(null);
      setExpiredZoneName(null);
      return;
    }
    function checkExpired() {
      fetch("/api/operator/expired-launches")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          setExpiredCount(data.count ?? 0);
          setExpiredAssetId(data.firstAssetId ?? null);
          setExpiredZoneMode(data.firstAssetZoneMode ?? null);
          setExpiredAlready(data.firstIsExpired ?? false);
          setExpiredAssetName(data.firstAssetName ?? null);
          setExpiredZoneName(data.firstZoneName ?? null);
        })
        .catch(() => {});
    }
    checkExpired();
    const interval = setInterval(checkExpired, EXPIRY_POLL_MS);
    return () => clearInterval(interval);
  }, [hidden, hasStays, hasLaunches]);
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
    // "Счётчики" — Возврат/тест + Списать с баланса на месте, без похода в
    // "Клиенты" (запрос пользователя 2026-07-24: "немного не единообразный
    // интерфейс... надо запоминать, что если по Счётчикам, то заходить в
    // Клиенты"; заодно сдача итогов больше не просит вспоминать возвраты из
    // головы — см. /operator/taps и submit/page.tsx). Та же иконка, что
    // у режима в кабинете владельца (points/[id]/page.tsx ACCOUNTING_MODE_ICON).
    ...(hasCounters
      ? [
          {
            href: "/operator/taps",
            label: t.zonesList.accountingModeCounters,
            icon: CircuitBoard,
            active: pathname.startsWith("/operator/taps"),
          },
        ]
      : []),
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
            badge: (goodsCartHasItems || hasOpenHeldOrders ? "green" : null) as "green" | null,
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
    // «Как работать» — памятка под этого сотрудника (решение владельца
    // 2026-08-16). Последним пунктом: она нужна редко, а места в баре мало —
    // пусть уходит в «Ещё», не вытесняя рабочие экраны.
    {
      href: "/operator/guide",
      label: t.operatorGuide.navLabel,
      icon: BookOpen,
      active: pathname.startsWith("/operator/guide"),
    },
  ];

  const effectiveBarSlots = isWide ? BAR_SLOTS_WIDE : BAR_SLOTS;
  const barItems = items.slice(0, effectiveBarSlots);
  const overflowItems = items.slice(effectiveBarSlots);

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
            onClick={() => {
              const base = expiredZoneMode === "launches" ? "/operator/launches" : "/operator/game-room";
              router.push(`${base}${expiredAssetId ? `?assetId=${expiredAssetId}` : ""}`);
            }}
            className="mx-auto flex w-full max-w-md items-center gap-2 rounded-control border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-left shadow-floating motion-safe:animate-pulse md:max-w-xl lg:max-w-2xl"
          >
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span className="flex-1 truncate text-caption-airbnb font-bold text-destructive">
              {(expiredAlready ? t.operatorApp.gameRoom.expiredNowBannerLabel : t.operatorApp.gameRoom.expiredBannerLabel)
                .replace("{name}", expiredAssetName ?? "")
                .replace("{zone}", expiredZoneName ?? "")}
            </span>
            <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[0.6875rem] font-bold text-white tabular-nums">
              {expiredCount}
            </span>
          </button>
        </PressableScale>
      )}
      {!hidden && (
        <BottomGlassNav
          items={barItems}
          moreLabel={t.nav.more}
          moreActive={overflowItems.some((item) => item.active)}
          // Пункт с точкой (например, "Товары" с непустой корзиной) может
          // оказаться спрятан в "Ещё" при 5+ пунктах — точка тогда
          // поднимается на саму кнопку "Ещё", иначе её не увидеть вообще.
          moreBadge={
            overflowItems.some((item) => item.badge === "green")
              ? "green"
              : overflowItems.some((item) => item.badge === "red")
                ? "red"
                : null
          }
          onMoreClick={() => setMoreOpen(true)}
          showMore={overflowItems.length > 0}
          hideOnDesktop={false}
        />
      )}

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <div className="flex flex-col pt-2">
          <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.nav.more}</h2>
          {overflowItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 border-t border-border py-3.5 text-left text-body-airbnb first:border-t-0"
              >
                <span className="relative shrink-0">
                  <Icon className="size-4" />
                  {item.badge && (
                    <span
                      className={cn(
                        "absolute -right-0.5 -top-0.5 size-2 rounded-full",
                        item.badge === "red" ? "bg-destructive" : "bg-success"
                      )}
                      style={{ boxShadow: "0 0 0 2px var(--card)" }}
                    />
                  )}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}
