"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRightLeft, Banknote, Check, ClipboardCheck, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";

interface ZoneOption {
  id: string;
  name: string;
}

interface PointOption {
  id: string;
  name: string;
}

export default function OperatorHomePage() {
  const router = useRouter();
  const t = useI18n();
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [operatorAvatarUrl, setOperatorAvatarUrl] = useState<string | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [pointName, setPointName] = useState<string | null>(null);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [checking, setChecking] = useState(true);
  const [roaming, setRoaming] = useState(false);
  const [switchPointOpen, setSwitchPointOpen] = useState(false);
  const [points, setPoints] = useState<PointOption[]>([]);

  const [showCollection, setShowCollection] = useState(false);
  const [collectionZoneId, setCollectionZoneId] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collectionDone, setCollectionDone] = useState(false);

  function loadMe() {
    fetch("/api/auth/operator/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.device || !data.operator) {
          router.replace("/operator/login");
          return;
        }
        setOperatorName(data.operator.name);
        setOperatorAvatarUrl(data.operator.avatarUrl ?? null);
        setPointId(data.device.pointId);
        setPointName(data.device.pointName);
        setRoaming(data.device.roaming === true);
        setChecking(false);
      });
  }

  function loadZones() {
    fetch("/api/operator/submission-context")
      .then((res) => res.json())
      .then((data) => setZones((data.zones ?? []).map((z: ZoneOption) => ({ id: z.id, name: z.name }))));
  }

  useEffect(() => {
    loadMe();
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleSwitchOperator() {
    await fetch("/api/auth/operator/logout", { method: "POST" });
    router.push("/operator/login");
    router.refresh();
  }

  function openSwitchPoint() {
    setSwitchPointOpen(true);
    fetch("/api/operator/points")
      .then((res) => res.json())
      .then((data) => setPoints(data.points ?? []));
  }

  async function handleSwitchPoint(targetPointId: string) {
    const res = await fetch("/api/operator/switch-point", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId: targetPointId }),
    });
    if (!res.ok) return;
    setSwitchPointOpen(false);
    loadMe();
    loadZones();
  }

  async function handleCollection(event: FormEvent) {
    event.preventDefault();
    setCollectionError(null);

    const res = await fetch("/api/operator/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId: collectionZoneId, amount: collectionAmount }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCollectionError(data.error ?? "Не удалось провести инкассацию");
      return;
    }
    setCollectionDone(true);
    setCollectionAmount("");
  }

  if (checking) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface-0 px-4">
      <SpringCard hover={false} className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          {operatorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={operatorAvatarUrl} alt="" className="size-21 rounded-full object-cover" />
          ) : (
            <div className="flex size-21 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
              {operatorName?.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="text-screen-title">
            {t.operatorApp.greeting} {operatorName}
          </h1>
          <div className="flex items-center gap-2">
            <p className="text-body-airbnb text-muted-foreground">
              {t.operatorApp.pointLabel} <span className="font-semibold text-foreground">{pointName}</span>
            </p>
            {roaming && (
              <button
                type="button"
                className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                onClick={() => (switchPointOpen ? setSwitchPointOpen(false) : openSwitchPoint())}
              >
                <MapPin className="size-3.5" />
                {t.operatorApp.switchPoint}
              </button>
            )}
          </div>

          {roaming && switchPointOpen && (
            <div className="w-full rounded-control border border-border p-1 text-left">
              <p className="px-2 py-1.5 text-caption-airbnb font-semibold">{t.operatorApp.choosePointTitle}</p>
              <div className="flex flex-col">
                {points.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSwitchPoint(p.id)}
                    className="flex items-center justify-between border-t border-border px-2 py-2.5 text-left text-body-airbnb first:border-t-0"
                  >
                    {p.name}
                    {p.id === pointId && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <PressableScale>
            <Button
              className="h-14 w-full gap-2 rounded-control text-base font-bold"
              onClick={() => router.push("/operator/submit")}
            >
              <ClipboardCheck className="size-5" />
              {t.operatorApp.submitResults}
            </Button>
          </PressableScale>

          {!showCollection ? (
            <PressableScale>
              <Button
                variant="outline"
                className="h-14 w-full gap-2 rounded-control border-2 text-base font-bold"
                onClick={() => {
                  setShowCollection(true);
                  setCollectionDone(false);
                }}
              >
                <Banknote className="size-5" />
                {t.operatorApp.collection}
              </Button>
            </PressableScale>
          ) : (
            <form onSubmit={handleCollection} className="flex flex-col gap-3 rounded-control border-2 border-border p-3">
              {collectionDone ? (
                <p className="text-body-airbnb text-success">{t.operatorApp.collectionDone}</p>
              ) : (
                <>
                  <Label htmlFor="collectionZone">{t.operatorApp.zoneLabel}</Label>
                  <select
                    id="collectionZone"
                    className="h-14 rounded-control border-2 border-input bg-background px-3 text-base"
                    value={collectionZoneId}
                    onChange={(e) => setCollectionZoneId(e.target.value)}
                    required
                  >
                    <option value="">{t.operatorApp.selectZone}</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                  <Label htmlFor="collectionAmount">{t.operatorApp.collectionAmountLabel}</Label>
                  <Input
                    id="collectionAmount"
                    inputMode="numeric"
                    className="h-14 border-2 text-lg tabular-nums"
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                    required
                  />
                  {collectionError && <p className="text-sm text-destructive">{collectionError}</p>}
                  <PressableScale>
                    <Button type="submit" className="h-12 w-full gap-2">
                      <Check className="size-4" />
                      {t.operatorApp.recordCollection}
                    </Button>
                  </PressableScale>
                </>
              )}
              <Button
                type="button"
                variant="link"
                className="h-auto gap-1 p-0 text-sm"
                onClick={() => setShowCollection(false)}
              >
                <X className="size-4" />
                {t.common.close}
              </Button>
            </form>
          )}
        </div>
      </SpringCard>

      <button
        type="button"
        className="mt-6 flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground"
        onClick={handleSwitchOperator}
      >
        <ArrowRightLeft className="size-3.5" />
        {t.operatorApp.switchOperator}
      </button>
    </div>
  );
}
