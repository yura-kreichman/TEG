"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Banknote, ChevronLeft, ChevronRight, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { formatTime } from "@/lib/datetime-format";
import { cn } from "@/lib/utils";
import { Money } from "@/components/money";

interface ZoneBalance {
  zoneId: string;
  zoneName: string;
  zoneIconKey: string | null;
  pointId: string;
  pointName: string;
  balance: number;
}

interface CollectionEntry {
  id: string;
  occurredAt: string;
  zoneName: string;
  pointName: string;
  amount: number;
}

type CollectionMode = "zone" | "general";

export default function ZoneBalancesPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [zoneBalances, setZoneBalances] = useState<ZoneBalance[]>([]);
  const [showPointName, setShowPointName] = useState(false);
  const [changeFundZoneId, setChangeFundZoneId] = useState<string | null>(null);
  const [changeFundAmount, setChangeFundAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Инкассация владельцем (запрос пользователя 2026-07-15: "как и у
  // Сотрудника") — тот же выбор "по зонам"/"общая", что в PWA оператора
  // (см. operator/page.tsx), плюс выбор точки, если их у тенанта больше
  // одной (оператор привязан к одному устройству/точке, владельцу нужно
  // выбрать явно).
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionPointId, setCollectionPointId] = useState("");
  const [collectionMode, setCollectionMode] = useState<CollectionMode>("zone");
  const [collectionZoneId, setCollectionZoneId] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collectionDone, setCollectionDone] = useState(false);

  // Реестр инкассаций — перенесён сюда с отдельного экрана /money/collections
  // (запрос пользователя 2026-07-15: "весь раздел Инкассации переносим в
  // 'Остаток наличных по зонам'").
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [collections, setCollections] = useState<CollectionEntry[]>([]);

  async function loadReport() {
    const res = await fetch("/api/reports/money");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setZoneBalances(data.zoneBalances ?? []);
    setShowPointName(!!data.showPointName);
    setChecking(false);
  }

  async function loadCollections() {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth() + 1;
    const res = await fetch(`/api/reports/money/collections?year=${year}&month=${month}`);
    if (res.ok) {
      const data = await res.json();
      setCollections(data.collections ?? []);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleChangeFund(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!changeFundZoneId) return;

    const res = await fetch(`/api/zones/${changeFundZoneId}/change-fund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: changeFundAmount }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Не удалось провести размен");
      return;
    }
    setChangeFundAmount("");
    setChangeFundZoneId(null);
    await loadReport();
  }

  const points = Array.from(new Map(zoneBalances.map((z) => [z.pointId, z.pointName])).entries()).map(
    ([id, name]) => ({ id, name })
  );
  const zonesForCollectionPoint = zoneBalances.filter((z) => z.pointId === collectionPointId);

  function openCollection() {
    setCollectionPointId(points[0]?.id ?? "");
    setCollectionMode("general");
    setCollectionZoneId("");
    setCollectionAmount("");
    setCollectionError(null);
    setCollectionDone(false);
    setCollectionOpen(true);
  }

  async function handleCollection(event: FormEvent) {
    event.preventDefault();
    setCollectionError(null);

    const res =
      collectionMode === "general"
        ? await fetch(`/api/points/${collectionPointId}/collection/general`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: collectionAmount }),
          })
        : await (async () => {
            if (!collectionZoneId) {
              setCollectionError(t.operatorApp.selectZone);
              return null;
            }
            return fetch(`/api/zones/${collectionZoneId}/collection`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ amount: collectionAmount }),
            });
          })();
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      setCollectionError(data.error ?? "Не удалось провести инкассацию");
      return;
    }
    setCollectionDone(true);
    setCollectionAmount("");
    await Promise.all([loadReport(), loadCollections()]);
  }

  function isCalendarCurrentMonth() {
    const today = new Date();
    return (
      calendarMonth.getUTCFullYear() === today.getUTCFullYear() && calendarMonth.getUTCMonth() === today.getUTCMonth()
    );
  }

  function stepCalendarMonth(delta: number) {
    if (delta > 0 && isCalendarCurrentMonth()) return;
    const next = new Date(calendarMonth);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setCalendarMonth(next);
  }

  function formatGroupDate(dateStr: string) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]}`;
  }

  const collectionGroups: { date: string; items: CollectionEntry[] }[] = [];
  for (const c of collections) {
    const dateKey = c.occurredAt.slice(0, 10);
    const lastGroup = collectionGroups[collectionGroups.length - 1];
    if (lastGroup && lastGroup.date === dateKey) lastGroup.items.push(c);
    else collectionGroups.push({ date: dateKey, items: [c] });
  }

  if (checking) return null;

  const activeZoneName = zoneBalances.find((z) => z.zoneId === changeFundZoneId)?.zoneName;
  const calYear = calendarMonth.getUTCFullYear();
  const calMonth = calendarMonth.getUTCMonth() + 1;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-3.5">
          <Link href="/money" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.money.title}
          </Link>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.money.zoneBalancesLink}</h1>
            <PressableScale>
              <Button variant="dark" size="sm" className="gap-1.5" onClick={openCollection}>
                <Plus className="size-4" />
                {t.money.recordCollectionButton}
              </Button>
            </PressableScale>
          </div>

          <SpringCard hover={false} className="flex flex-col gap-1">
            {Object.entries(
              zoneBalances.reduce<Record<string, { pointName: string; zones: ZoneBalance[] }>>((acc, zb) => {
                (acc[zb.pointId] ??= { pointName: zb.pointName, zones: [] }).zones.push(zb);
                return acc;
              }, {})
            ).map(([pointId, group]) => (
              <div key={pointId}>
                {showPointName && (
                  <p className="pt-3 text-caption-airbnb font-semibold text-foreground">{group.pointName}</p>
                )}
                {group.zones.map((zb) => (
                  <div
                    key={zb.zoneId}
                    className="flex items-center justify-between border-t border-border py-3 pl-1 first:border-t-0"
                  >
                    <p className="text-body-airbnb">{zb.zoneName}</p>
                    <div className="flex items-center gap-3.5">
                      <span
                        className={cn(
                          "text-[0.96875rem] font-bold tabular-nums",
                          zb.balance === 0 && "font-medium text-muted-foreground"
                        )}
                      >
                        <Money value={zb.balance} />
                      </span>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                        onClick={() => {
                          setChangeFundZoneId(zb.zoneId);
                          setChangeFundAmount("");
                          setError(null);
                        }}
                      >
                        <Banknote className="size-3.5" />
                        {t.money.changeFund}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </SpringCard>

          <SpringCard hover={false} className="flex flex-col gap-3">
            <span className="text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
              {t.money.collectionsRegisterTitle}
            </span>
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label={t.readings.prevMonth}
                onClick={() => stepCalendarMonth(-1)}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
              >
                <ChevronLeft className="size-4.5" />
              </button>
              <p className="text-card-title">
                {t.readings.months[calMonth - 1]} {calYear}
              </p>
              <button
                type="button"
                aria-label={t.readings.nextMonth}
                onClick={() => stepCalendarMonth(1)}
                disabled={isCalendarCurrentMonth()}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4.5" />
              </button>
            </div>
            {collectionGroups.length === 0 ? (
              <p className="text-caption-airbnb text-muted-foreground">{t.money.noCollections}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {collectionGroups.map((group) => (
                  <div key={group.date}>
                    <p className="mb-1 text-caption-airbnb font-semibold text-muted-foreground">
                      {formatGroupDate(group.date)}
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
                        >
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            {formatTime(c.occurredAt)} · {c.zoneName}
                            {showPointName ? ` (${c.pointName})` : ""}
                          </span>
                          <span className="shrink-0 text-xs font-bold tabular-nums"><Money value={c.amount} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SpringCard>
        </div>
      </div>

      <BottomSheet open={changeFundZoneId !== null} onClose={() => setChangeFundZoneId(null)}>
        <form onSubmit={handleChangeFund} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {t.money.changeFundAmountFor} «{activeZoneName}»
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="changeFundAmount">{t.money.amountLabel}</Label>
            <div className="flex items-center gap-2">
              <MoneyInput
                id="changeFundAmount"
                autoFocus
                className="h-12 flex-1"
                value={changeFundAmount}
                onChange={(e) => setChangeFundAmount(e.target.value)}
                required
              />
              <PressableScale>
                <SaveButton type="submit" className="h-12">
                  {t.common.save}
                </SaveButton>
              </PressableScale>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </BottomSheet>

      <BottomSheet open={collectionOpen} onClose={() => setCollectionOpen(false)}>
        <form onSubmit={handleCollection} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.collection}</h2>
          {collectionDone ? (
            <p className="text-body-airbnb text-success">{t.operatorApp.collectionDone}</p>
          ) : (
            <>
              {points.length > 1 && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="collectionPoint">{t.money.pointLabel}</Label>
                  <Select
                    value={collectionPointId || null}
                    onValueChange={(v) => {
                      setCollectionPointId(v ?? "");
                      setCollectionZoneId("");
                    }}
                    items={points.map((p) => ({ value: p.id, label: p.name }))}
                  >
                    <SelectTrigger id="collectionPoint">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {points.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {zonesForCollectionPoint.length > 1 && (
                <SegmentedTabs
                  shape="control"
                  options={[
                    { key: "zone" as const, label: t.operatorApp.collectionModeZone },
                    { key: "general" as const, label: t.operatorApp.collectionModeGeneral },
                  ]}
                  value={collectionMode}
                  onChange={setCollectionMode}
                />
              )}

              {collectionMode === "zone" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="collectionZone">{t.operatorApp.zoneLabel}</Label>
                  <Select
                    value={collectionZoneId || null}
                    onValueChange={(v) => setCollectionZoneId(v ?? "")}
                    items={zonesForCollectionPoint.map((z) => ({ value: z.zoneId, label: z.zoneName }))}
                  >
                    <SelectTrigger id="collectionZone">
                      {(() => {
                        const current = zonesForCollectionPoint.find((z) => z.zoneId === collectionZoneId);
                        if (!current) return <SelectValue placeholder={t.operatorApp.selectZone} />;
                        return (
                          <SelectValue>
                            <span className="flex items-center gap-2">
                              {current.zoneIconKey ? (
                                <AssetOrZoneIcon iconKey={current.zoneIconKey} className="size-5 shrink-0" />
                              ) : (
                                <MapPin className="size-5 shrink-0 text-muted-foreground" />
                              )}
                              {current.zoneName}
                            </span>
                          </SelectValue>
                        );
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      {zonesForCollectionPoint.map((z) => (
                        <SelectItem key={z.zoneId} value={z.zoneId}>
                          <span className="flex items-center gap-2">
                            {z.zoneIconKey ? (
                              <AssetOrZoneIcon iconKey={z.zoneIconKey} className="size-5 shrink-0" />
                            ) : (
                              <MapPin className="size-5 shrink-0 text-muted-foreground" />
                            )}
                            {z.zoneName}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-caption-airbnb">{t.operatorApp.collectionGeneralHint}</p>
              )}

              <div className="flex flex-col gap-1">
                <Label htmlFor="collectionAmount">
                  {collectionMode === "general" ? t.money.collectionGeneralAmountLabel : t.money.collectionAmountLabel}
                </Label>
                <div className="flex items-center gap-2">
                  <MoneyInput
                    id="collectionAmount"
                    autoFocus
                    className="h-12 flex-1"
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                    required
                  />
                  <PressableScale>
                    <SaveButton type="submit" className="h-12">
                      {t.common.save}
                    </SaveButton>
                  </PressableScale>
                </div>
              </div>
              {collectionError && <p className="text-sm text-destructive">{collectionError}</p>}
            </>
          )}
        </form>
      </BottomSheet>
    </OwnerShell>
  );
}
