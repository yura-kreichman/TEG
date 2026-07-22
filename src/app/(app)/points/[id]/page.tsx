"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Banknote, Check, ChevronRight, CircuitBoard, ClockPlus, Plus, Ticket, Timer, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconPicker } from "@/components/icon-picker";
import { StatusChip } from "@/components/status-chip";
import { ActiveStatusIcon } from "@/components/active-status-icon";
import { TileIcon } from "@/components/tile-icon";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { ZONE_ACCOUNTING_MODES, isStaysZone, isTicketsZone, type ZoneAccountingMode } from "@/lib/results-calc";
import { useSavePulse } from "@/hooks/use-save-pulse";
import type { Dictionary } from "@/lib/i18n";

interface ZoneInfo {
  id: string;
  name: string;
  iconKey: string | null;
  telegramEmoji: string | null;
  accountingMode: ZoneAccountingMode;
  active: boolean;
  tariffs: { id: string; name: string; price: string }[];
  assets: { id: string }[];
}

// "stays"/"tickets" — самостоятельные режимы учёта, рядоположные остальным
// (решение пользователя 2026-07-17 для stays, было суб-режимом "launches" до
// этого; tickets добавлен 2026-07-22, docs/spec/10-tickets.md) — единый
// список из пяти, без второго уровня выбора.
const ACCOUNTING_MODE_LABEL: Record<ZoneAccountingMode, (t: Dictionary) => string> = {
  counters: (t) => t.zonesList.accountingModeCounters,
  launches: (t) => t.zonesList.accountingModeLaunches,
  cash_only: (t) => t.zonesList.accountingModeCashOnly,
  stays: (t) => t.zonesList.accountingModeStays,
  tickets: (t) => t.zonesList.accountingModeTickets,
};
const ACCOUNTING_MODE_HINT: Record<ZoneAccountingMode, (t: Dictionary) => string> = {
  counters: (t) => t.zonesList.accountingModeCountersHint,
  launches: (t) => t.zonesList.accountingModeLaunchesHint,
  cash_only: (t) => t.zonesList.accountingModeCashOnlyHint,
  stays: (t) => t.zonesList.accountingModeStaysHint,
  tickets: (t) => t.zonesList.accountingModeTicketsHint,
};
// Иконки режимов учёта (запрос пользователя 2026-07-18) — "Прибывания" тот
// же Timer, что и одноимённый пункт нижнего бара Сотрудника (единообразие).
const ACCOUNTING_MODE_ICON: Record<ZoneAccountingMode, LucideIcon> = {
  counters: CircuitBoard,
  launches: ClockPlus,
  cash_only: Banknote,
  stays: Timer,
  tickets: Ticket,
};

export default function PointDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [zones, setZones] = useState<ZoneInfo[]>([]);
  const [pointName, setPointName] = useState("");
  // Иерархия деактивации: точка → зона → актив (запрос пользователя
  // 2026-07-16) — если сама точка деактивирована, все её зоны визуально
  // тоже "серые", даже если у каждой отдельно zone.active === true; и
  // оператору такие зоны в любом случае не попадут (см. requireOperator).
  const [pointActive, setPointActive] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [accountingMode, setAccountingMode] = useState<ZoneAccountingMode>("counters");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { saved: createSaved, pulse: createPulse } = useSavePulse();

  async function loadZones() {
    const res = await fetch(`/api/points/${params.id}/zones`);
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setZones(data.zones ?? []);
    setPointName(data.pointName ?? "");
    setPointActive(data.pointActive ?? true);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/points/${params.id}/zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, iconKey, accountingMode }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось создать зону");
        return;
      }

      await loadZones();
      createPulse(() => {
        setName("");
        setIconKey(null);
        setAccountingMode("counters");
        setCreateOpen(false);
      });
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <Link href="/points" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.zonesList.allPoints}
          </Link>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.zonesList.title}</h1>
            <PressableScale>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setAccountingMode("counters");
                  setCreateOpen(true);
                }}
              >
                <Plus className="size-4" />
                {t.common.add}
              </Button>
            </PressableScale>
          </div>
          <p className="mb-4 text-caption-airbnb">{pointName}</p>

          {zones.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.zonesList.noZones}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3.5">
              {zones.map((zone) => (
                <StaggerItem key={zone.id}>
                  <PressableScale>
                    <Link href={`/zones/${zone.id}`} className="block">
                      <SpringCard animate={false} className={cn((!pointActive || !zone.active) && "grayscale")}>
                        <div className="flex items-center gap-3">
                          <TileIcon iconKey={zone.iconKey} emoji={zone.telegramEmoji} />
                          <div className="min-w-0 grow">
                            <div className="flex items-center gap-1.5">
                              <div className="text-card-title">{zone.name}</div>
                              {/* Не кнопка (запрос пользователя 2026-07-22) —
                                  переключение только в кебаб-меню на самой
                                  странице зоны, куда ведёт вся карточка. */}
                              <ActiveStatusIcon
                                active={pointActive && zone.active}
                                activeLabel={t.zonesList.zoneActiveChip}
                                inactiveLabel={t.zonesList.zoneInactiveChip}
                              />
                            </div>
                            <p className="text-caption-airbnb">
                              {zone.accountingMode === "cash_only"
                                ? t.zonesList.modeChip.cash_only
                                : `${zone.assets.length} ${t.zonesList.assetsCount}`}
                              {zone.accountingMode !== "cash_only" &&
                                ` · ${t.zonesList.modeChip[zone.accountingMode]}`}
                            </p>
                          </div>
                          <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                        </div>
                        {/* Билеты не участвуют в этом блоке — у них нет
                            тарифов вовсе, цены на активах (docs/spec/10-
                            tickets.md, "ЦЕНЫ — НА АКТИВАХ, НЕ ТАРИФЫ"); без
                            исключения тут ложно показывался бы warning-чип
                            "Нет тарифов" на КАЖДОЙ tickets-зоне. */}
                        {zone.accountingMode !== "cash_only" && !isStaysZone(zone) && !isTicketsZone(zone) && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {zone.tariffs.length === 0 ? (
                              <StatusChip variant="warning">{t.zonesList.noTariffs}</StatusChip>
                            ) : (
                              zone.tariffs.map((tariff) => (
                                <span
                                  key={tariff.id}
                                  className="rounded-full bg-surface-0 px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground"
                                >
                                  {tariff.name} · {tariff.price}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </SpringCard>
                    </Link>
                  </PressableScale>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.zonesList.newZoneTitle}</h2>
            <p className="text-caption-airbnb">{t.zonesList.newZoneSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">{t.zonesList.nameLabel}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t.zonesList.iconLabel}</Label>
            <IconPicker value={iconKey} onChange={setIconKey} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t.zonesList.accountingModeLabel}</Label>
            <div className="rounded-control border border-border">
              {ZONE_ACCOUNTING_MODES.map((mode) => {
                const ModeIcon = ACCOUNTING_MODE_ICON[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAccountingMode(mode)}
                    className="flex w-full items-center gap-3 border-t border-border px-3 py-2.5 text-left first:border-t-0"
                  >
                    <ModeIcon className="size-5 shrink-0 text-muted-foreground" />
                    <span className="grow">
                      <span className="block text-body-airbnb">{ACCOUNTING_MODE_LABEL[mode](t)}</span>
                      <span className="block text-caption-airbnb">{ACCOUNTING_MODE_HINT[mode](t)}</span>
                    </span>
                    {accountingMode === mode && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <SaveButton type="submit" disabled={loading} className="h-12 w-full" saved={createSaved} />
          </PressableScale>
        </form>
      </BottomSheet>
    </OwnerShell>
  );
}
