"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { isLaunchesZone } from "@/lib/results-calc";
import { cn } from "@/lib/utils";

interface TariffCtx {
  id: string;
  name: string;
  price: number;
}

interface AssetCtx {
  id: string;
  name: string;
  iconKey: string | null;
  photoUrl: string | null;
  colorTag: string;
  active: boolean;
}

interface AssetWithZone extends AssetCtx {
  zoneId: string;
  zoneName: string;
}

interface ZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  assets: AssetCtx[];
  tariffs: TariffCtx[];
}

interface TallyEntry {
  assetId: string;
  tariffId: string;
  count: number;
  amount: number;
}

const POLL_MS = 6000;
const ALL_ZONES = "all";

/**
 * Экран "Пуски" в PWA оператора (docs/spec/04-game-room.md, режим
 * "launches") — точка входа из нижнего бара напрямую сюда, без
 * промежуточного списка зон (запрос пользователя 2026-07-17: "открываются
 * все активы с dropdown фильтром по зонам", тот же принцип, что и у
 * "Прибываний"). Тайлы активов ВСЕХ зон режима "launches" разом, dropdown
 * сверху сужает до одной зоны. Тап мгновенно учитывает один пуск (нет
 * браслетов, нет старта/стопа во времени) — цифровая замена бумажной
 * тетрадки с плюсиками.
 */
export default function LaunchesZonePage() {
  const router = useRouter();
  const t = useI18n();

  const [zones, setZones] = useState<ZoneCtx[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string>(ALL_ZONES);
  const [entries, setEntries] = useState<TallyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Тап по активу — если тарифов у его зоны больше одного, сперва выбор
  // тарифа, затем способ оплаты; с одним тарифом шаг выбора пропускается
  // (tariffId проставляется сразу), см. handleTileTap. zoneId нужен явно —
  // активы разных зон смешаны в одном гриде.
  const [tapFlow, setTapFlow] = useState<{ zoneId: string; assetId: string; tariffId?: string } | null>(null);

  function loadZones() {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          router.replace("/operator/login");
          return;
        }
        const launches: ZoneCtx[] = (data.zones ?? [])
          .filter(isLaunchesZone)
          .map(
            (z: { id: string; name: string; iconKey: string | null; assets: AssetCtx[]; tariffs: TariffCtx[] }) => ({
              id: z.id,
              name: z.name,
              iconKey: z.iconKey,
              assets: z.assets ?? [],
              tariffs: z.tariffs ?? [],
            })
          );
        if (launches.length === 0) {
          router.replace("/operator");
          return;
        }
        setZones(launches);
        setLoading(false);
      });
  }

  function loadTallies(zoneList: ZoneCtx[]) {
    Promise.all(
      zoneList.map((z) => fetch(`/api/zones/${z.id}/tally`).then((res) => (res.ok ? res.json() : null)))
    ).then((results) => {
      const merged: TallyEntry[] = [];
      for (const data of results) {
        if (data?.entries) merged.push(...data.entries);
      }
      setEntries(merged);
    });
  }

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (zones.length === 0) return;
    loadTallies(zones);
    const interval = setInterval(() => loadTallies(zones), POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  const allAssets: AssetWithZone[] = useMemo(
    () => zones.flatMap((z) => z.assets.map((a) => ({ ...a, zoneId: z.id, zoneName: z.name }))),
    [zones]
  );
  const filteredAssets = zoneFilter === ALL_ZONES ? allAssets : allAssets.filter((a) => a.zoneId === zoneFilter);

  const countByAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.assetId, (map.get(e.assetId) ?? 0) + e.count);
    return map;
  }, [entries]);

  function handleTileTap(asset: AssetWithZone) {
    if (!asset.active || submitting) return;
    const zone = zones.find((z) => z.id === asset.zoneId);
    if (!zone || zone.tariffs.length === 0) {
      setError(t.operatorApp.gameRoom.noPricingError);
      return;
    }
    setError(null);
    setTapFlow(
      zone.tariffs.length === 1
        ? { zoneId: zone.id, assetId: asset.id, tariffId: zone.tariffs[0].id }
        : { zoneId: zone.id, assetId: asset.id }
    );
  }

  async function logTap(zoneId: string, assetId: string, tariffId: string, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/zones/${zoneId}/tally`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, tariffId, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setTapFlow(null);
      loadTallies(zones);
    } catch {
      // Сетевая ошибка — пуск на сервере не создан (тот же принцип, что и у
      // "Прибываний"), повтор безопасен.
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  const filterZone = zones.find((z) => z.id === zoneFilter) ?? null;
  const tapZone = tapFlow ? (zones.find((z) => z.id === tapFlow.zoneId) ?? null) : null;
  const tapAsset = tapFlow ? (allAssets.find((a) => a.id === tapFlow.assetId) ?? null) : null;
  const tapTariff = tapFlow?.tariffId ? (tapZone?.tariffs.find((tf) => tf.id === tapFlow.tariffId) ?? null) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <h1 className="mb-4 text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.tally.entryTitle}</h1>

        {zones.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <Label className="shrink-0">{t.operatorApp.tally.zoneFilterLabel}</Label>
            <div className="min-w-0 flex-1">
              <Select
                value={zoneFilter}
                onValueChange={(v) => v && setZoneFilter(v)}
                items={[
                  { value: ALL_ZONES, label: t.operatorApp.tally.allZonesOption },
                  ...zones.map((z) => ({ value: z.id, label: z.name })),
                ]}
              >
                <SelectTrigger className="h-11 w-full bg-muted">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {filterZone ? (
                        filterZone.iconKey ? (
                          <AssetOrZoneIcon iconKey={filterZone.iconKey} className="size-5 shrink-0" />
                        ) : (
                          <MapPin className="size-5 shrink-0 text-muted-foreground" />
                        )
                      ) : (
                        <Layers className="size-5 shrink-0 text-muted-foreground" />
                      )}
                      {filterZone ? filterZone.name : t.operatorApp.tally.allZonesOption}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONES}>
                    <span className="flex items-center gap-2">
                      <Layers className="size-5 shrink-0 text-muted-foreground" />
                      {t.operatorApp.tally.allZonesOption}
                    </span>
                  </SelectItem>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      <span className="flex items-center gap-2">
                        {z.iconKey ? (
                          <AssetOrZoneIcon iconKey={z.iconKey} className="size-5 shrink-0" />
                        ) : (
                          <MapPin className="size-5 shrink-0 text-muted-foreground" />
                        )}
                        {z.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {filteredAssets.length === 0 ? (
          <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.noAssetsYet}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredAssets.map((a) => {
              const count = countByAsset.get(a.id) ?? 0;
              return (
                <PressableScale key={a.id}>
                  <button
                    type="button"
                    onClick={() => handleTileTap(a)}
                    disabled={!a.active || submitting}
                    className="flex w-full flex-col overflow-hidden rounded-card border-[1.5px] border-border bg-card text-left disabled:opacity-40"
                  >
                    <div className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
                      {a.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.photoUrl} alt="" className="size-full object-contain object-center" />
                      ) : a.iconKey ? (
                        <AssetOrZoneIcon iconKey={a.iconKey} className="size-10 text-muted-foreground" />
                      ) : (
                        <MapPin className="size-9 text-muted-foreground" />
                      )}
                      <span
                        className="absolute left-2.5 top-2.5 size-4 rounded-full ring-[2.5px] ring-card"
                        style={{ backgroundColor: a.colorTag }}
                      />
                      {/* Счётчик пусков — значительно крупнее прежнего (запрос
                          пользователя 2026-07-17: "количество пусков надо
                          сделать значительно крупнее"), главное число на
                          тайле, вместо мелкого бейджа-подсказки. */}
                      {count > 0 && (
                        <span className="absolute right-2 top-2 flex min-w-11 items-center justify-center rounded-full bg-primary px-2.5 py-1.5 text-2xl font-extrabold tabular-nums text-primary-foreground shadow-md ring-2 ring-card">
                          {count}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 p-3">
                      <span className="truncate text-[0.90625rem] font-bold tracking-[-0.01em]">{a.name}</span>
                      {zoneFilter === ALL_ZONES && zones.length > 1 && (
                        <span className="truncate text-[0.75rem] text-muted-foreground">{a.zoneName}</span>
                      )}
                    </div>
                  </button>
                </PressableScale>
              );
            })}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      <BottomSheet open={tapFlow !== null} onClose={() => setTapFlow(null)}>
        {tapFlow && !tapFlow.tariffId && tapZone && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.pickOptionTitle}</h2>
            <div className="flex flex-col gap-2">
              {tapZone.tariffs.map((tf) => (
                <PressableScale key={tf.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between font-semibold"
                    disabled={submitting}
                    onClick={() => setTapFlow({ zoneId: tapFlow.zoneId, assetId: tapFlow.assetId, tariffId: tf.id })}
                  >
                    <span>{tf.name}</span>
                    <Money value={tf.price} />
                  </Button>
                </PressableScale>
              ))}
            </div>
          </div>
        )}
        {tapFlow?.tariffId && tapAsset && tapTariff && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.paymentMethodTitle}</h2>
            <p className={cn("text-caption-airbnb text-muted-foreground")}>
              {tapAsset.name} · {tapTariff.name} · <Money value={tapTariff.price} />
            </p>
            <div className="flex flex-col gap-2">
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full font-semibold"
                  disabled={submitting}
                  onClick={() => logTap(tapFlow.zoneId, tapFlow.assetId, tapFlow.tariffId!, "cash")}
                >
                  {t.operatorApp.submit.cashLabel}
                </Button>
              </PressableScale>
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full font-semibold"
                  disabled={submitting}
                  onClick={() => logTap(tapFlow.zoneId, tapFlow.assetId, tapFlow.tariffId!, "mobile")}
                >
                  {t.operatorApp.submit.mobileLabel}
                </Button>
              </PressableScale>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
