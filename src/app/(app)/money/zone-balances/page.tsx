"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Banknote } from "lucide-react";
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

export default function ZoneBalancesPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [zoneBalances, setZoneBalances] = useState<ZoneBalance[]>([]);
  const [changeFundZoneId, setChangeFundZoneId] = useState<string | null>(null);
  const [changeFundAmount, setChangeFundAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    const res = await fetch("/api/reports/money");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setZoneBalances(data.zoneBalances ?? []);
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

  if (checking) return null;

  const activeZoneName = zoneBalances.find((z) => z.zoneId === changeFundZoneId)?.zoneName;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-3.5">
          <Link href="/money" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.money.title}
          </Link>
          <h1 className="text-screen-title">{t.money.zoneBalancesLink}</h1>

          <SpringCard hover={false} className="flex flex-col gap-1">
            {Object.entries(
              zoneBalances.reduce<Record<string, { pointName: string; zones: ZoneBalance[] }>>((acc, zb) => {
                (acc[zb.pointId] ??= { pointName: zb.pointName, zones: [] }).zones.push(zb);
                return acc;
              }, {})
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
                          "text-[0.96875rem] font-bold tabular-nums",
                          zb.balance === 0 && "font-medium text-muted-foreground"
                        )}
                      >
                        {zb.balance.toFixed(2)}
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
        </div>
      </div>

      <BottomSheet open={changeFundZoneId !== null} onClose={() => setChangeFundZoneId(null)}>
        <form onSubmit={handleChangeFund} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
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
