"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, MapPin, Plus, Square, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { useLiveNow } from "@/hooks/use-live-now";
import { estimateLiveAmount, formatMMSS, type LaunchPricingMode, type LaunchRoundingMode } from "@/lib/game-room-client";
import { unlockBeep, playBeep } from "@/lib/beep";
import { cn } from "@/lib/utils";

interface AssetCtx {
  id: string;
  name: string;
  colorTag: string;
  photoUrl: string | null;
  iconKey: string | null;
  active: boolean;
}

interface ZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  assets: AssetCtx[];
}

interface OpenLaunch {
  id: string;
  assetId: string | null;
  number: number;
  label: string | null;
  startedAt: string;
  pricingMode: LaunchPricingMode;
  priceSnapshot: number;
  durationMinutesSnapshot: number | null;
  roundingModeSnapshot: LaunchRoundingMode | null;
  minAmountSnapshot: number | null;
}

const SOUND_HINT_KEY = "gameRoomSoundHintSeen";
const POLL_MS = 6000;

export default function GameRoomZonePage() {
  const params = useParams<{ zoneId: string }>();
  const router = useRouter();
  const t = useI18n();
  const now = useLiveNow();

  const [zone, setZone] = useState<ZoneCtx | null>(null);
  const [launches, setLaunches] = useState<OpenLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [labelSheetFor, setLabelSheetFor] = useState<string | "zone" | null>(null); // assetId or "zone"
  const [labelValue, setLabelValue] = useState("");
  const [starting, setStarting] = useState(false);

  const [listSheetFor, setListSheetFor] = useState<string | "zone" | null>(null);
  const [confirmingStopId, setConfirmingStopId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const [soundHintOpen, setSoundHintOpen] = useState(false);
  const alertedRef = useRef<Set<string>>(new Set());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window !== "undefined" && !window.localStorage.getItem(SOUND_HINT_KEY)) {
      setSoundHintOpen(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function dismissSoundHint() {
    unlockBeep();
    window.localStorage.setItem(SOUND_HINT_KEY, "1");
    setSoundHintOpen(false);
  }

  function loadZone() {
    fetch("/api/operator/submission-context")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          router.replace("/operator/login");
          return;
        }
        const z = (data.zones ?? []).find((zz: { id: string }) => zz.id === params.zoneId);
        if (!z) {
          router.replace("/operator");
          return;
        }
        setZone({ id: z.id, name: z.name, iconKey: z.iconKey, assets: z.assets ?? [] });
        setLoading(false);
      });
  }

  function loadLaunches() {
    fetch(`/api/zones/${params.zoneId}/launches`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setLaunches(data.launches ?? []);
      });
  }

  useEffect(() => {
    loadZone();
    loadLaunches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.zoneId]);

  useEffect(() => {
    const interval = setInterval(loadLaunches, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.zoneId]);

  // Сигнал истечения (docs/spec/04-game-room.md) — только fixed с длительностью,
  // разово на каждый пуск (не повторяется каждый рендер после первого срабатывания).
  useEffect(() => {
    for (const l of launches) {
      if (l.pricingMode !== "fixed" || l.durationMinutesSnapshot == null) continue;
      const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
      if (now.getTime() >= expiresAt && !alertedRef.current.has(l.id)) {
        alertedRef.current.add(l.id);
        playBeep();
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
      }
    }
  }, [launches, now]);

  function isExpired(l: OpenLaunch): boolean {
    if (l.pricingMode !== "fixed" || l.durationMinutesSnapshot == null) return false;
    const expiresAt = new Date(l.startedAt).getTime() + l.durationMinutesSnapshot * 60000;
    return now.getTime() >= expiresAt;
  }

  const launchesByAsset = useMemo(() => {
    const map = new Map<string, OpenLaunch[]>();
    for (const l of launches) {
      const key = l.assetId ?? "zone";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return map;
  }, [launches]);

  async function startLaunch(assetId: string | null, label: string | null) {
    setStarting(true);
    setError(null);
    unlockBeep();
    try {
      const res = await fetch(`/api/zones/${params.zoneId}/launches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, label }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.noPricingError);
        return;
      }
      loadLaunches();
      setLabelSheetFor(null);
      setLabelValue("");
    } catch {
      // Сетевая ошибка (не HTTP-ошибка от сервера) — docs/spec/04-game-room.md,
      // Шаг 6: "стоп даёт внятную ошибку и не теряет пуск" — то же верно и для
      // старта. Ничего на сервере не создалось, повтор безопасен.
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStarting(false);
    }
  }

  async function stopLaunch(launchId: string) {
    setStopping(true);
    setError(null);
    try {
      const res = await fetch(`/api/launches/${launchId}/stop`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "");
        return;
      }
      setConfirmingStopId(null);
      loadLaunches();
    } catch {
      // Пуск на сервере не потерян (запрос мог не дойти или ответ не
      // вернуться) — оператор видит понятную ошибку и может повторить "Стоп",
      // повторный вызов на уже закрытый пуск сервер отклонит отдельной
      // проверкой isOpen, не задвоит закрытие.
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setStopping(false);
    }
  }

  if (loading || !zone) return null;

  // Тайл активов — та же карточка, что в мастере сдачи итогов (счётчики):
  // фото/иконка + цветная метка + подпись снизу (запрос пользователя
  // 2026-07-16: "как в других зонах", единый визуальный язык). Тариф —
  // свойство актива (2026-07-16: "игровые комнаты — это активы, у каждой
  // своя цена"), поэтому зона без активов не может ничего запустить — нет
  // псевдо-тайла на всю зону, вместо него пустое состояние ниже.
  const tiles: {
    key: string;
    assetId: string | null;
    name: string;
    iconKey: string | null;
    photoUrl: string | null;
    colorTag: string | null;
    active: boolean;
  }[] = zone.assets.map((a) => ({
    key: a.id,
    assetId: a.id,
    name: a.name,
    iconKey: a.iconKey,
    photoUrl: a.photoUrl,
    colorTag: a.colorTag,
    active: a.active,
  }));

  const listLaunches = listSheetFor ? launchesByAsset.get(listSheetFor) ?? [] : [];

  return (
    <div className="flex min-h-dvh flex-col bg-background px-4 pb-10 pt-6" onPointerDownCapture={() => unlockBeep()}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-3 flex w-fit items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {t.common.back}
        </button>

        <div className="mb-4 flex items-center gap-2.5">
          {zone.iconKey ? (
            <AssetOrZoneIcon iconKey={zone.iconKey} className="size-7" />
          ) : (
            <MapPin className="size-7 text-muted-foreground" />
          )}
          <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{zone.name}</h1>
        </div>

        {tiles.length === 0 ? (
          <p className="py-4 text-center text-body-airbnb text-muted-foreground">
            {t.operatorApp.gameRoom.noAssetsYet}
          </p>
        ) : (
          <>
        <p className="mb-3 text-[0.84375rem] text-muted-foreground">{t.operatorApp.gameRoom.pickAssetHint}</p>

        <div className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => {
            const tileLaunches = launchesByAsset.get(tile.key) ?? [];
            const openCount = tileLaunches.length;
            const nearest = tileLaunches
              .slice()
              .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())[0];
            const anyExpired = tileLaunches.some(isExpired);

            return (
              <PressableScale key={tile.key}>
                <button
                  type="button"
                  onClick={() =>
                    openCount > 0
                      ? setListSheetFor(tile.key)
                      : tile.active && startLaunch(tile.assetId, null)
                  }
                  disabled={starting || (!tile.active && openCount === 0)}
                  className={cn(
                    "relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left",
                    openCount > 0 ? "border-primary" : "border-border",
                    !tile.active && "grayscale",
                    anyExpired && "border-destructive motion-safe:animate-pulse"
                  )}
                >
                  <div className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
                    {tile.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={tile.photoUrl} alt="" className="size-full object-contain object-center" />
                    ) : tile.iconKey ? (
                      <AssetOrZoneIcon iconKey={tile.iconKey} className="size-12 text-muted-foreground" />
                    ) : (
                      <MapPin className="size-10 text-muted-foreground" />
                    )}
                    {tile.colorTag && (
                      <span
                        className="absolute left-2.5 top-2.5 size-4 rounded-full ring-[2.5px] ring-card"
                        style={{ backgroundColor: tile.colorTag }}
                      />
                    )}
                    {tile.active && (
                      <PressableScale>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLabelValue("");
                            setLabelSheetFor(tile.key === "zone" ? "zone" : tile.assetId);
                          }}
                          className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-sm"
                        >
                          <Tag className="size-3.5" />
                        </span>
                      </PressableScale>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 p-3">
                    <span className="text-[0.90625rem] font-bold tracking-[-0.01em]">{tile.name}</span>
                    {openCount > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-primary">
                        {openCount} {t.operatorApp.gameRoom.openCountSuffix}
                        {nearest && (
                          <span className="text-muted-foreground">
                            · {formatMMSS(now.getTime() - new Date(nearest.startedAt).getTime())}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs leading-snug text-muted-foreground">
                        <Plus className="size-3 shrink-0" />
                        {t.operatorApp.gameRoom.labelStartButton}
                      </span>
                    )}
                  </div>
                </button>
              </PressableScale>
            );
          })}
        </div>
          </>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {/* Метка при старте — второе касание (docs/spec/04-game-room.md: старт не
          должен требовать больше двух тапов; первый тап на самом тайле уже
          стартует без метки). */}
      <BottomSheet open={labelSheetFor !== null} onClose={() => setLabelSheetFor(null)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.labelSheetTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="launchLabel">{t.operatorApp.gameRoom.labelSheetTitle}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="launchLabel"
                autoFocus
                className="h-14 flex-1 text-lg"
                placeholder={t.operatorApp.gameRoom.labelPlaceholder}
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
              />
              <PressableScale>
                <SaveButton
                  className="h-14"
                  disabled={starting}
                  onClick={() =>
                    startLaunch(labelSheetFor === "zone" ? null : (labelSheetFor as string), labelValue.trim() || null)
                  }
                />
              </PressableScale>
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* Список открытых пусков актива/зоны + стоп с подтверждением. */}
      <BottomSheet open={listSheetFor !== null} onClose={() => { setListSheetFor(null); setConfirmingStopId(null); }}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {tiles.find((tl) => tl.key === listSheetFor)?.name}
          </h2>
          {listLaunches.map((l) => {
            const expired = isExpired(l);
            const elapsedMs = now.getTime() - new Date(l.startedAt).getTime();
            const liveAmount = estimateLiveAmount(
              l.pricingMode,
              l.priceSnapshot,
              l.roundingModeSnapshot,
              l.minAmountSnapshot,
              new Date(l.startedAt),
              now
            );
            const confirming = confirmingStopId === l.id;
            return (
              <div
                key={l.id}
                className={cn(
                  "flex flex-col gap-2 rounded-control border border-border p-3",
                  expired && "border-destructive bg-destructive/5 motion-safe:animate-pulse"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body-airbnb font-semibold">
                    {t.operatorApp.gameRoom.launchNumberPrefix} {l.number}
                    {l.label && <span className="font-normal text-muted-foreground"> · {l.label}</span>}
                  </span>
                  {!confirming && (
                    <PressableScale>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setConfirmingStopId(l.id)}
                      >
                        <Square className="size-3.5" />
                        {t.operatorApp.gameRoom.stopButton}
                      </Button>
                    </PressableScale>
                  )}
                </div>
                <p className="text-caption-airbnb tabular-nums">
                  {expired
                    ? t.operatorApp.gameRoom.expiredLabel
                    : l.pricingMode === "fixed" && l.durationMinutesSnapshot
                      ? `${t.operatorApp.gameRoom.remainingLabel}: ${formatMMSS(
                          l.durationMinutesSnapshot * 60000 - elapsedMs
                        )}`
                      : formatMMSS(elapsedMs)}
                  {l.pricingMode === "per_minute" && (
                    <>
                      {" "}
                      · {t.operatorApp.gameRoom.currentAmountLabel} <Money value={liveAmount} />
                    </>
                  )}
                </p>
                {confirming && (
                  <div className="flex flex-col gap-2 border-t border-border pt-2">
                    <p className="text-caption-airbnb">
                      {t.operatorApp.gameRoom.stopDurationLabel}: {formatMMSS(elapsedMs)} ·{" "}
                      {t.operatorApp.gameRoom.stopAmountLabel}: <Money value={liveAmount} />
                    </p>
                    <PressableScale>
                      <Button
                        type="button"
                        className="h-11 w-full gap-1.5 font-bold"
                        disabled={stopping}
                        onClick={() => stopLaunch(l.id)}
                      >
                        {t.operatorApp.gameRoom.stopConfirmButton}
                      </Button>
                    </PressableScale>
                  </div>
                )}
              </div>
            );
          })}
          {listLaunches.length === 0 && (
            <p className="py-4 text-center text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.emptyState}</p>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={soundHintOpen} onClose={dismissSoundHint}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.gameRoom.entryTitle}</h2>
          <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.soundHintBody}</p>
          <PressableScale>
            <Button className="h-12 w-full font-bold" onClick={dismissSoundHint}>
              {t.common.close}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </div>
  );
}
