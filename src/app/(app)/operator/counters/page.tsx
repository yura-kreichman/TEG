"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, Wallet, Trash2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { BackLink } from "@/components/back-link";
import { IconActionButton } from "@/components/kebab-menu";
import { SpringCard } from "@/components/spring-card";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { AbonementTopupFlow, type SpendZoneCtx } from "@/components/abonement-topup-flow";
import { useI18n } from "@/components/i18n-provider";
import { formatTime } from "@/lib/datetime-format";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface CounterZone {
  id: string;
  name: string;
  iconKey: string | null;
}

interface ReturnEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  createdAt: string;
}

/**
 * Пункт нижнего бара "Счётчики" (запрос пользователя 2026-07-24) — раньше
 * Сотрудник для зон режима "Счётчики" шёл в "Клиенты" за списанием с
 * баланса, а возвраты/тестовые пуски вспоминал "из головы" на мастере сдачи
 * итогов ("Немного не единообразный интерфейс... надо запоминать, что если
 * по Счётчикам, то заходить в Клиенты"). Теперь оба действия — тут, а сдача
 * итогов только суммирует эту же таблицу (см. submit-results/route.ts).
 * Видим в баре только когда у оператора есть хоть одна зона режима
 * "Счётчики" (operator-bottom-nav.tsx, hasCounters).
 */
export default function OperatorCountersPage() {
  const t = useI18n();
  const [zones, setZones] = useState<CounterZone[]>([]);
  const [events, setEvents] = useState<ReturnEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  const [returnZone, setReturnZone] = useState<CounterZone | null>(null);
  const [logging, setLogging] = useState(false);
  const { saved: returnSaved, pulse: returnPulse } = useSavePulse();

  const [spendSheetOpen, setSpendSheetOpen] = useState(false);
  // undefined — ещё грузится (кнопка "Списать с баланса" скрыта до ответа
  // сервера, тот же приём, что раньше был в /operator/abonements).
  const [spendZones, setSpendZones] = useState<SpendZoneCtx[] | undefined>(undefined);

  function loadEvents() {
    fetch("/api/operator/zone-return-events")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setZones(data.zones ?? []);
        setEvents(data.events ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadEvents();
    fetch("/api/operator/counter-zones")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSpendZones(data?.zones ?? []));
  }, []);

  function openReturnSheet() {
    setReturnSheetOpen(true);
    setReturnZone(zones.length === 1 ? zones[0] : null);
  }

  function countFor(zoneId: string): number {
    return events.filter((e) => e.zoneId === zoneId).length;
  }

  async function logReturn(zone: CounterZone) {
    if (logging) return;
    setLogging(true);
    try {
      const res = await fetch("/api/operator/zone-return-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: zone.id }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setEvents((prev) => [{ id: data.id, zoneId: zone.id, zoneName: zone.name, createdAt: data.createdAt }, ...prev]);
      // SaveButton сам шлёт "save-success-fly" при переходе saved false→true
      // (см. save-button.tsx) — раньше это дублировалось вручную здесь.
      returnPulse();
    } finally {
      setLogging(false);
    }
  }

  async function deleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/operator/zone-return-events/${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 md:max-w-xl lg:max-w-2xl">
          <Skeleton className="mb-2 h-7 w-32" />
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-24 rounded-card" />
          <SkeletonListRows count={3} />
        </div>
      </div>
    );
  }

  // "Списать с баланса" — полноэкранно, как раньше был отдельный экран
  // "Клиенты" (запрос пользователя 2026-07-24: "лучше не bottom-sheet, а
  // входить в окно, как было") — в отличие от "Возврат/тест" (короткое
  // действие, шторка уместна), тут телефон+нумпад+зона+тариф, полноценный
  // многошаговый флоу.
  if (spendSheetOpen) {
    return (
      <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 md:max-w-xl lg:max-w-2xl">
          <BackLink
            crumbs={[t.zonesList.accountingModeCounters, t.operatorApp.abonement.spendTitle]}
            onClick={() => setSpendSheetOpen(false)}
          />
          <AbonementTopupFlow
            plans={[]}
            timezoneEndpoint="/api/operator/tenant-timezone"
            searchEndpoint="/api/operator/abonements"
            createEndpoint="/api/operator/abonements"
            topupEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/topup`}
            allowZoneSpend
            spendZones={spendZones}
            zoneSpendEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/zone-spend`}
            spendOnlyMode
            toastErrors
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.zonesList.accountingModeCounters}</h1>

        {/* "Списать с баланса" — тот же стиль/размер, что у "Сдача итогов" на
            Главной (запрос пользователя 2026-07-24), это главное действие
            здесь; "Возврат/тест" — уже, второстепенное действие рядом. */}
        <div className="flex gap-3">
          <PressableScale className="flex-1">
            <Button
              type="button"
              disabled={!spendZones || spendZones.length === 0}
              onClick={() => setSpendSheetOpen(true)}
              className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control p-2 text-center text-base font-bold"
            >
              <Wallet className="size-7" />
              <span className="leading-tight">{t.operatorApp.abonement.spendTitle}</span>
            </Button>
          </PressableScale>
          <PressableScale className="relative w-28 shrink-0">
            <button
              type="button"
              onClick={openReturnSheet}
              className="relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-control border-[1.5px] border-border bg-card p-2 text-center"
            >
              {events.length > 0 && (
                <span className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-muted text-lg font-extrabold tabular-nums text-muted-foreground shadow-md">
                  {events.length}
                </span>
              )}
              <RefreshCcw className="size-6 text-muted-foreground" />
              <span className="text-xs leading-snug font-bold whitespace-normal">{t.operatorApp.submit.returnsCardLabel}</span>
            </button>
          </PressableScale>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-caption-airbnb font-semibold text-muted-foreground">{t.operatorApp.counters.logTitle}</p>
          {events.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.counters.emptyLog}</p>
          ) : (
            <StaggerList className="flex flex-col gap-2.5">
              {events.map((e) => (
                <StaggerItem key={e.id}>
                  <SpringCard animate={false} className="!p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                        <RefreshCcw className="size-4" />
                      </div>
                      <div className="min-w-0 grow">
                        <div className="truncate text-body-airbnb font-semibold">{e.zoneName}</div>
                        <p className="text-caption-airbnb text-muted-foreground">{formatTime(e.createdAt)}</p>
                      </div>
                      <IconActionButton icon={Trash2} onClick={() => deleteEvent(e.id)} label={t.common.delete} destructive />
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={returnSheetOpen} onClose={() => setReturnSheetOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          {zones.length > 1 && !returnZone && (
            <>
              <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.counters.pickZoneTitle}</h2>
              {/* Тап сразу переключает на следующий экран (returnZone
                  устанавливается и этот блок размонтируется), поэтому
                  "выбранного" состояния тут никогда не бывает видно — только
                  сама сетка/стиль тайла общий со "Сдачей итогов"/"Расходами". */}
              <div className="grid grid-cols-3 gap-3">
                {zones.map((zone) => (
                  <PressableScale key={zone.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setReturnZone(zone)}
                      className="relative flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] border-border bg-card px-3 py-5 text-center"
                    >
                      <div className="flex size-14 items-center justify-center rounded-control bg-muted text-muted-foreground/50">
                        {zone.iconKey ? <AssetOrZoneIcon iconKey={zone.iconKey} className="size-9" /> : <MapPin className="size-9" />}
                      </div>
                      <span className="text-[0.90625rem] font-semibold text-foreground">{zone.name}</span>
                    </button>
                  </PressableScale>
                ))}
              </div>
            </>
          )}
          {(returnZone || zones.length === 1) && (
            <>
              {zones.length > 1 && <BackLink label={t.common.back} onClick={() => setReturnZone(null)} />}
              <div className="flex flex-col items-center gap-4 py-2 text-center">
                <p className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{(returnZone ?? zones[0]).name}</p>
                <p className="text-body-airbnb text-muted-foreground">
                  {t.operatorApp.counters.todayCountLabel} <span className="font-bold text-foreground">{countFor((returnZone ?? zones[0]).id)}</span>
                </p>
                <PressableScale className="w-full">
                  <SaveButton
                    type="button"
                    className="h-14 w-full text-lg font-bold"
                    disabled={logging}
                    saved={returnSaved}
                    onClick={() => logReturn(returnZone ?? zones[0])}
                  />
                </PressableScale>
              </div>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
