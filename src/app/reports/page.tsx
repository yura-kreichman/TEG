"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, ChevronRight } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { TileIcon } from "@/components/tile-icon";
import { useI18n } from "@/components/i18n-provider";

interface PointInfo {
  id: string;
  name: string;
  iconKey: string | null;
}

export default function ReportsPointPickerPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [points, setPoints] = useState<PointInfo[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/points");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      const list: PointInfo[] = data.points ?? [];
      if (list.length === 1) {
        router.replace(`/reports/${list[0].id}`);
        return;
      }
      setPoints(list);
      setChecking(false);
    }
    load();
  }, [router]);

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <h1 className="text-screen-title">{t.reports.pickPointTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.reports.pickPointSub}</p>

          {points.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.reports.noPoints}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3.5">
              {points.map((point) => (
                <StaggerItem key={point.id}>
                  <SpringCard animate={false}>
                    <Link href={`/reports/${point.id}`} className="flex items-center gap-3">
                      <TileIcon iconKey={point.iconKey} fallback={BarChart3} />
                      <div className="min-w-0 grow text-card-title">{point.name}</div>
                      <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>
    </OwnerShell>
  );
}
