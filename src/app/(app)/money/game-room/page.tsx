"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { useLiveNow } from "@/hooks/use-live-now";
import { formatMMSS } from "@/lib/game-room-client";

interface OpenLaunch {
  id: string;
  number: number;
  label: string | null;
  startedAt: string;
}

interface AssetLive {
  key: string;
  assetId: string;
  name: string;
  iconKey: string | null;
  colorTag: string | null;
  photoUrl: string | null;
  zoneId: string;
  zoneName: string;
  pointId: string;
  pointName: string;
  todayCount: number;
  openLaunches: OpenLaunch[];
}

const POLL_MS = 12000;

// "Сейчас на точке" — карточка на КАЖДЫЙ АКТИВ, не на зону (запрос
// пользователя 2026-07-16: "на территории парка есть 2 игровые комнаты —
// это активы"; тариф — свойство актива, значит и наблюдаемая владельцем
// единица — актив). Зона без активов не может иметь пусков вовсе и не
// участвует в списке, см. /api/reports/game-room/live.
export default function GameRoomLivePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const now = useLiveNow();
  const pointId = searchParams.get("pointId");

  const [assets, setAssets] = useState<AssetLive[]>([]);
  const [checking, setChecking] = useState(true);

  function load() {
    const query = pointId ? `?pointId=${pointId}` : "";
    fetch(`/api/reports/game-room/live${query}`)
      .then((res) => (res.status === 401 ? null : res.ok ? res.json() : { assets: [] }))
      .then((data) => {
        if (data === null) {
          router.replace("/login");
          return;
        }
        setAssets(data.assets ?? []);
        setChecking(false);
      });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const showZoneName = assets.some((a) => a.zoneId !== assets[0]?.zoneId);
  const showPointName = assets.some((a) => a.pointId !== assets[0]?.pointId);

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
          <Link href="/money" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.money.title}
          </Link>
          <h1 className="text-screen-title">{t.zoneDetail.gameRoomLiveLink}</h1>

          {assets.length === 0 ? (
            <SpringCard hover={false}>
              <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.emptyState}</p>
            </SpringCard>
          ) : (
            assets.map((asset) => (
              <SpringCard key={asset.key} hover={false} className="flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
                    {asset.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.photoUrl} alt="" className="size-full object-cover" />
                    ) : asset.iconKey ? (
                      <AssetOrZoneIcon iconKey={asset.iconKey} className="size-5" />
                    ) : (
                      <MapPin className="size-5 text-muted-foreground" />
                    )}
                    {asset.colorTag && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card"
                        style={{ backgroundColor: asset.colorTag }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 grow">
                    <p className="text-card-title truncate">{asset.name}</p>
                    <p className="text-caption-airbnb text-muted-foreground truncate">
                      {showZoneName && asset.zoneName}
                      {showZoneName && showPointName && " · "}
                      {showPointName && asset.pointName}
                      {(showZoneName || showPointName) && " · "}
                      {asset.todayCount} {t.zonesList.launchesTodaySuffix}
                    </p>
                  </div>
                </div>

                {asset.openLaunches.length === 0 ? (
                  <p className="text-caption-airbnb text-muted-foreground">{t.operatorApp.gameRoom.emptyState}</p>
                ) : (
                  <div className="flex flex-col">
                    {asset.openLaunches.map((l) => (
                      <div
                        key={l.id}
                        className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-t-0"
                      >
                        <span className="min-w-0 truncate text-body-airbnb">
                          {t.operatorApp.gameRoom.launchNumberPrefix} {l.number}
                          {l.label && <span className="text-muted-foreground"> · {l.label}</span>}
                        </span>
                        <span className="shrink-0 text-caption-airbnb font-semibold tabular-nums">
                          {formatMMSS(now.getTime() - new Date(l.startedAt).getTime())}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SpringCard>
            ))
          )}
        </div>
      </div>
    </OwnerShell>
  );
}
