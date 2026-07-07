"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface ZoneBalance {
  zoneId: string;
  zoneName: string;
  pointId: string;
  pointName: string;
  balance: number;
}

interface Report {
  zoneBalances: ZoneBalance[];
  business: { revenue: number; expense: number; profit: number };
}

export default function MoneyPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [changeFundZoneId, setChangeFundZoneId] = useState<string | null>(null);
  const [changeFundAmount, setChangeFundAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    const res = await fetch("/api/reports/money");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    setReport(await res.json());
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  if (checking || !report) return null;

  const activeZoneName = report.zoneBalances.find((z) => z.zoneId === changeFundZoneId)?.zoneName;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-3.5">
          <h1 className="text-screen-title">{t.money.title}</h1>

          <SpringCard hover={false} className="flex flex-col gap-4">
            <h2 className="text-section-title">{t.money.businessTitle}</h2>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[34px] font-extrabold tracking-[-0.02em]">
                {report.business.profit.toFixed(2)}
              </span>
              <span className="text-body-airbnb text-muted-foreground">{t.money.profit}</span>
            </div>
            <div className="flex border-t border-border pt-3.5 tabular-nums">
              <div className="flex-1">
                <p className="text-caption-airbnb">{t.money.revenue}</p>
                <p className="text-[17px] font-bold">{report.business.revenue.toFixed(2)}</p>
              </div>
              <div className="flex-1 border-l border-border pl-4">
                <p className="text-caption-airbnb">{t.money.expense}</p>
                <p className="text-[17px] font-bold">{report.business.expense.toFixed(2)}</p>
              </div>
              <div className="flex-1 border-l border-border pl-4">
                <p className="text-caption-airbnb">{t.money.profit}</p>
                <p className="text-[17px] font-bold text-primary">+{report.business.profit.toFixed(2)}</p>
              </div>
            </div>
          </SpringCard>

          <SpringCard hover={false} className="flex flex-col gap-1">
            <h2 className="text-section-title">{t.money.balancesTitle}</h2>

            {Object.entries(
              report.zoneBalances.reduce<Record<string, { pointName: string; zones: ZoneBalance[] }>>(
                (acc, zb) => {
                  (acc[zb.pointId] ??= { pointName: zb.pointName, zones: [] }).zones.push(zb);
                  return acc;
                },
                {}
              )
            ).map(([pointId, group]) => (
              <div key={pointId}>
                <p className="pt-3 text-caption-airbnb font-semibold text-foreground">{group.pointName}</p>
                {group.zones.map((zb) => (
                  <div
                    key={zb.zoneId}
                    className="flex items-center justify-between border-t border-border py-3 pl-1 first:border-t-0"
                  >
                    <p className="text-body-airbnb">{zb.zoneName}</p>
                    <div className="flex items-center gap-3.5">
                      <span
                        className={cn(
                          "text-[15.5px] font-bold tabular-nums",
                          zb.balance === 0 && "font-medium text-muted-foreground"
                        )}
                      >
                        {zb.balance.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        className="text-caption-airbnb font-semibold text-primary"
                        onClick={() => {
                          setChangeFundZoneId(zb.zoneId);
                          setChangeFundAmount("");
                          setError(null);
                        }}
                      >
                        {t.money.changeFund}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </SpringCard>

          <PressableScale>
            <Link href="/money/readings">
              <SpringCard className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                  <CalendarDays className="size-5" />
                </div>
                <div className="min-w-0 grow">
                  <p className="text-card-title">{t.money.readingsLink}</p>
                  <p className="text-caption-airbnb">{t.money.readingsLinkHint}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </SpringCard>
            </Link>
          </PressableScale>
        </div>
      </div>

      <BottomSheet open={changeFundZoneId !== null} onClose={() => setChangeFundZoneId(null)}>
        <form onSubmit={handleChangeFund} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">
            {t.money.changeFundAmountFor} «{activeZoneName}»
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="changeFundAmount">{t.money.amountLabel}</Label>
            <Input
              id="changeFundAmount"
              autoFocus
              inputMode="numeric"
              value={changeFundAmount}
              onChange={(e) => setChangeFundAmount(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <Button type="submit" className="w-full">
              {t.money.submitButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>
    </OwnerShell>
  );
}
