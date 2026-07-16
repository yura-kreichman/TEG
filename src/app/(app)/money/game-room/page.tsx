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
  assetName: string | null;
  number: number;
  label: string | null;
  startedAt: string;
}

interface ZoneLive {
  id: string;
  name: string;
  iconKey: string | null;
  pointId: string;
  pointName: string;
  todayCount: number;
  openLaunches: OpenLaunch[];
}

const POLL_MS = 12000;

export default function GameRoomLivePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const now = useLiveNow();
  const pointId = searchParams.get("pointId");

  const [zones, setZones] = useState<ZoneLive[]>([]);
  const [checking, setChecking] = useState(true);

  function load() {
    const query = pointId ? `?pointId=${pointId}` : "";
    fetch(`/api/reports/game-room/live${query}`)
      .then((res) => (res.status === 401 ? null : res.ok ? res.json() : { zones: [] }))
      .then((data) => {
        if (data === null) {
          router.replace("/login");
          return;
        }
        setZones(data.zones ?? []);
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

  const showPointName = zones.some((z) => z.pointId !== zones[0]?.pointId);

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
          <Link href="/" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.nav.home}
          </Link>
          <h1 className="text-screen-title">{t.zoneDetail.gameRoomLiveLink}</h1>

          {zones.length === 0 ? (
            <SpringCard hover={false}>
              <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.gameRoom.emptyState}</p>
            </SpringCard>
          ) : (
            zones.map((zone) => (
              <SpringCard key={zone.id} hover={false} className="flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                    {zone.iconKey ? (
                      <AssetOrZoneIcon iconKey={zone.iconKey} className="size-5" />
                    ) : (
                      <MapPin className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0 grow">
                    <p className="text-card-title truncate">
                      {zone.name}
                      {showPointName && <span className="font-normal text-muted-foreground"> · {zone.pointName}</span>}
                    </p>
                    <p className="text-caption-airbnb text-muted-foreground">
                      {zone.todayCount} {t.zonesList.launchesTodaySuffix}
                    </p>
                  </div>
                </div>

                {zone.openLaunches.length === 0 ? (
                  <p className="text-caption-airbnb text-muted-foreground">{t.operatorApp.gameRoom.emptyState}</p>
                ) : (
                  <div className="flex flex-col">
                    {zone.openLaunches.map((l) => (
                      <div
                        key={l.id}
                        className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-t-0"
                      >
                        <span className="min-w-0 truncate text-body-airbnb">
                          {t.operatorApp.gameRoom.launchNumberPrefix} {l.number}
                          {l.assetName && <span className="text-muted-foreground"> · {l.assetName}</span>}
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
