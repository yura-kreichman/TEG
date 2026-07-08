"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Home, MapPin, Minus, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ImageLightbox } from "@/components/motion/image-lightbox";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { calcSessions, calcZoneRevenue } from "@/lib/results-calc";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface TariffCtx {
  id: string;
  name: string;
  price: string;
  order: number;
}
interface AssetCtx {
  id: string;
  name: string;
  colorTag: string;
  photoUrl: string | null;
  iconKey: string | null;
  previousReadings: Record<string, number>;
}
interface ZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  accountingMode: "counters" | "launches" | "cash_only";
  tariffs: TariffCtx[];
  assets: AssetCtx[];
}

interface ZoneFormState {
  returnsCount: string;
  cashAmount: string;
  mobileAmount: string;
  readings: Record<string, string>; // key: `${assetId}:${tariffId}`
}

interface ExpenseRow {
  zoneId: string;
  amount: string;
  comment: string;
}

type Step = { kind: "select" } | { kind: "zone"; zoneId: string } | { kind: "expenses" } | { kind: "review" };

export default function SubmitResultsPage() {
  const router = useRouter();
  const t = useI18n();
  const [loading, setLoading] = useState(true);
  const [zones, setZones] = useState<ZoneCtx[]>([]);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [zoneForms, setZoneForms] = useState<Record<string, ZoneFormState>>({});
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [counterAssetId, setCounterAssetId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    summary: { zoneId: string; zoneName: string; calculatedRevenue: number; actualCash: number; difference: number }[];
    remindMarkDeparture?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/operator/submission-context")
      .then(async (res) => {
        if (!res.ok) {
          router.replace("/operator/login");
          return;
        }
        const data = await res.json();
        setZones(data.zones ?? []);
        setLoading(false);
      });
  }, [router]);

  const steps: Step[] = useMemo(() => {
    const list: Step[] = [{ kind: "select" }];
    for (const zoneId of selectedZoneIds) list.push({ kind: "zone", zoneId });
    if (selectedZoneIds.length > 0) list.push({ kind: "expenses" }, { kind: "review" });
    return list;
  }, [selectedZoneIds]);

  const currentStep = steps[stepIndex] ?? steps[0];

  function toggleZone(zoneId: string) {
    setSelectedZoneIds((prev) =>
      prev.includes(zoneId) ? prev.filter((id) => id !== zoneId) : [...prev, zoneId]
    );
    setZoneForms((prev) => {
      if (prev[zoneId]) return prev;
      return { ...prev, [zoneId]: { returnsCount: "0", cashAmount: "", mobileAmount: "", readings: {} } };
    });
  }

  function updateZoneField(zoneId: string, field: keyof Omit<ZoneFormState, "readings">, value: string) {
    setZoneForms((prev) => ({ ...prev, [zoneId]: { ...prev[zoneId], [field]: value } }));
  }

  function updateReading(zoneId: string, key: string, value: string) {
    setZoneForms((prev) => ({
      ...prev,
      [zoneId]: { ...prev[zoneId], readings: { ...prev[zoneId].readings, [key]: value } },
    }));
  }

  function handlePhotoPressStart(url: string) {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setLightboxUrl(url);
    }, 350);
  }

  function handlePhotoPressEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    setLightboxUrl(null);
  }

  function handlePhotoClick(event: React.MouseEvent) {
    if (longPressFired.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressFired.current = false;
    }
  }

  function addExpense() {
    setExpenses((prev) => [
      ...prev,
      { zoneId: selectedZoneIds[0] ?? "", amount: "", comment: "" },
    ]);
  }

  function updateExpense(index: number, field: keyof ExpenseRow, value: string) {
    setExpenses((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }

  function removeExpense(index: number) {
    setExpenses((prev) => prev.filter((_, i) => i !== index));
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function previewFor(zoneId: string) {
    const zone = zones.find((z) => z.id === zoneId);
    const form = zoneForms[zoneId];
    if (!zone || !form) return null;

    const tariffCalc = zone.tariffs.map((tariff) => {
      const sessions = zone.assets.reduce((sum, asset) => {
        const key = `${asset.id}:${tariff.id}`;
        const current = Number(form.readings[key] ?? asset.previousReadings[tariff.id] ?? 0);
        if (zone.accountingMode === "launches") return sum + current;
        const previous = asset.previousReadings[tariff.id] ?? 0;
        return sum + calcSessions(current, previous);
      }, 0);
      return { tariffId: tariff.id, price: Number(tariff.price), sessions };
    });

    const calculatedRevenue = calcZoneRevenue(tariffCalc, Number(form.returnsCount || 0));
    const actualCash = Number(form.cashAmount || 0) + Number(form.mobileAmount || 0);
    const difference = Math.round((actualCash - calculatedRevenue) * 100) / 100;
    return { calculatedRevenue, actualCash, difference };
  }

  function isAssetFilled(zone: ZoneCtx, asset: AssetCtx, form: ZoneFormState) {
    return zone.tariffs.every((tariff) => (form.readings[`${asset.id}:${tariff.id}`] ?? "") !== "");
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);

    const zoneSubmissions = selectedZoneIds.map((zoneId) => {
      const zone = zones.find((z) => z.id === zoneId)!;
      const form = zoneForms[zoneId];
      const readings = zone.assets.flatMap((asset) =>
        zone.tariffs.map((tariff) => ({
          assetId: asset.id,
          tariffId: tariff.id,
          reading: Number(form.readings[`${asset.id}:${tariff.id}`] ?? asset.previousReadings[tariff.id] ?? 0),
        }))
      );
      return {
        zoneId,
        returnsCount: Number(form.returnsCount || 0),
        cashAmount: Number(form.cashAmount || 0),
        mobileAmount: Number(form.mobileAmount || 0),
        readings,
      };
    });

    const payload = {
      zoneSubmissions,
      expenses: expenses
        .filter((e) => e.amount)
        .map((e) => ({ zoneId: e.zoneId, amount: Number(e.amount), comment: e.comment })),
    };

    const res = await fetch("/api/operator/submit-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      setSubmitError(data.error ?? "Не удалось отправить сдачу итогов");
      setSubmitting(false);
      return;
    }

    setResult(data);
    setSubmitting(false);
  }

  if (loading) return null;

  if (result) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-10">
        <SpringCard hover={false} className="w-full max-w-md">
          <h1 className="text-screen-title">{t.operatorApp.submit.acceptedTitle}</h1>
          <div className="mt-4 flex flex-col gap-3">
            {result.summary.map((s) => (
              <div
                key={s.zoneId}
                className="flex flex-col gap-1 rounded-control border border-border p-3 text-body-airbnb"
              >
                <span className="font-semibold">{s.zoneName}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t.operatorApp.submit.calculatedRevenue} {s.calculatedRevenue.toFixed(2)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {t.operatorApp.submit.actualCash} {s.actualCash.toFixed(2)}
                </span>
                <span className="tabular-nums font-semibold">
                  {t.operatorApp.submit.difference} {s.difference > 0 ? "+" : ""}
                  {s.difference.toFixed(2)}
                </span>
              </div>
            ))}
            {result.remindMarkDeparture && (
              <p className="rounded-control bg-warning/15 px-3 py-2 text-sm font-medium text-warning">
                {t.operatorApp.workTime.markDepartureReminder}
              </p>
            )}
            <PressableScale>
              <Button onClick={() => router.push("/operator")} className="h-14 w-full gap-2 rounded-control font-bold">
                <Home className="size-5" />
                {t.operatorApp.submit.homeButton}
              </Button>
            </PressableScale>
          </div>
        </SpringCard>
      </div>
    );
  }

  const activeZone = currentStep.kind === "zone" ? zones.find((z) => z.id === currentStep.zoneId) ?? null : null;
  const activeForm = activeZone ? zoneForms[activeZone.id] : null;
  const activeAsset =
    activeZone && counterAssetId ? activeZone.assets.find((a) => a.id === counterAssetId) ?? null : null;

  const filledCount =
    activeZone && activeForm ? activeZone.assets.filter((a) => isAssetFilled(activeZone, a, activeForm)).length : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-background px-4 pb-32 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={stepIndex === 0 ? () => router.push("/operator") : goBack}
            className="flex items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {stepIndex === 0 ? t.operatorApp.submit.cancelWizard : t.common.back}
          </button>
          <span className="text-caption-airbnb font-semibold text-muted-foreground/70">
            {t.operatorApp.submit.stepLabel} {stepIndex + 1} {t.common.of} {steps.length}
          </span>
        </div>

        <div className="mt-3 mb-5 flex gap-1.5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-border")}
            />
          ))}
        </div>

        {currentStep.kind === "select" && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">
                {t.operatorApp.submit.selectZonesTitle}
              </h1>
              <p className="mt-1 text-[13.5px] text-muted-foreground">{t.operatorApp.submit.selectZonesSub}</p>
            </div>

            {zones.length === 0 ? (
              <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.submit.noZonesConfigured}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {zones.map((zone) => {
                  const selected = selectedZoneIds.includes(zone.id);
                  return (
                    <PressableScale key={zone.id}>
                      <button
                        type="button"
                        onClick={() => toggleZone(zone.id)}
                        className={cn(
                          "relative flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] px-3 py-5 text-center",
                          selected ? "border-primary bg-primary/10" : "border-border bg-card"
                        )}
                      >
                        {selected && (
                          <span className="absolute right-2.5 top-2.5 flex size-5.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        )}
                        <div
                          className={cn(
                            "flex size-14 items-center justify-center rounded-control",
                            selected ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/50"
                          )}
                        >
                          {zone.iconKey ? (
                            <AssetOrZoneIcon iconKey={zone.iconKey} className="size-6" />
                          ) : (
                            <MapPin className="size-6" />
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[14.5px] font-semibold",
                            selected ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {zone.name}
                        </span>
                      </button>
                    </PressableScale>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {currentStep.kind === "zone" && activeZone && activeForm && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{activeZone.name}</h1>
              <p className="mt-1 text-[13.5px] text-muted-foreground">
                {activeZone.accountingMode === "cash_only"
                  ? t.operatorApp.submit.cashOnlySub
                  : t.operatorApp.submit.enterReadingsSub}
              </p>
            </div>

            {activeZone.accountingMode !== "cash_only" && (
            <>
            <div className="grid grid-cols-2 gap-3">
              {activeZone.assets.map((asset) => {
                const filled = isAssetFilled(activeZone, asset, activeForm);
                return (
                  <PressableScale key={asset.id}>
                    <button
                      type="button"
                      onClick={() => setCounterAssetId(asset.id)}
                      className={cn(
                        "relative flex w-full flex-col overflow-hidden rounded-card border-[1.5px] bg-card text-left",
                        filled ? "border-success" : "border-border"
                      )}
                    >
                      <div
                        className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden bg-muted"
                        {...(asset.photoUrl
                          ? {
                              onPointerDown: () => handlePhotoPressStart(asset.photoUrl!),
                              onPointerUp: handlePhotoPressEnd,
                              onPointerLeave: handlePhotoPressEnd,
                              onPointerCancel: handlePhotoPressEnd,
                              onClick: handlePhotoClick,
                            }
                          : {})}
                      >
                        {asset.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.photoUrl} alt="" className="size-full object-contain object-center" />
                        ) : asset.iconKey ? (
                          <AssetOrZoneIcon iconKey={asset.iconKey} className="size-7 text-muted-foreground" />
                        ) : null}
                        <span
                          className="absolute left-2.5 top-2.5 size-4 rounded-full ring-[2.5px] ring-card"
                          style={{ backgroundColor: asset.colorTag }}
                        />
                        {filled && (
                          <span className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full bg-success text-success-foreground shadow-sm">
                            <Check className="size-3.5" />
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 p-3">
                        <span className="text-[14.5px] font-bold tracking-[-0.01em]">{asset.name}</span>
                        <span className="text-xs leading-snug text-muted-foreground">
                          {filled
                            ? activeZone.tariffs
                                .map((tariff) => `${tariff.name}: ${activeForm.readings[`${asset.id}:${tariff.id}`]}`)
                                .join(" · ")
                            : t.operatorApp.submit.assetNotFilled}
                        </span>
                      </div>
                    </button>
                  </PressableScale>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-card p-3.5">
              <div>
                <p className="text-body-airbnb font-semibold">{t.operatorApp.submit.returnsLabel}</p>
                <p className="mt-0.5 text-caption-airbnb">{t.operatorApp.submit.extrasHint}</p>
              </div>
              <div className="flex items-center overflow-hidden rounded-control border border-border">
                <button
                  type="button"
                  className="flex size-10 items-center justify-center bg-muted"
                  onClick={() =>
                    updateZoneField(
                      activeZone.id,
                      "returnsCount",
                      String(Math.max(0, Number(activeForm.returnsCount || 0) - 1))
                    )
                  }
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-11 text-center text-[15px] font-bold tabular-nums">
                  {activeForm.returnsCount || 0}
                </span>
                <button
                  type="button"
                  className="flex size-10 items-center justify-center bg-muted"
                  onClick={() =>
                    updateZoneField(activeZone.id, "returnsCount", String(Number(activeForm.returnsCount || 0) + 1))
                  }
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
            </>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="cash">{t.operatorApp.submit.cashLabel}</Label>
              <Input
                id="cash"
                inputMode="numeric"
                className="h-14 rounded-control bg-muted text-lg font-bold tabular-nums"
                value={activeForm.cashAmount}
                onChange={(e) => updateZoneField(activeZone.id, "cashAmount", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mobile">{t.operatorApp.submit.mobileLabel}</Label>
              <Input
                id="mobile"
                inputMode="numeric"
                className="h-14 rounded-control bg-muted text-lg font-bold tabular-nums"
                value={activeForm.mobileAmount}
                onChange={(e) => updateZoneField(activeZone.id, "mobileAmount", e.target.value)}
              />
            </div>

            {activeZone.accountingMode !== "cash_only" &&
              (() => {
                const preview = previewFor(activeZone.id);
                return (
                  preview && (
                    <p className="text-caption-airbnb tabular-nums">
                      {t.operatorApp.submit.calculatedRevenue} {preview.calculatedRevenue.toFixed(2)} ·{" "}
                      {t.operatorApp.submit.difference} {preview.difference > 0 ? "+" : ""}
                      {preview.difference.toFixed(2)}
                    </p>
                  )
                );
              })()}
          </div>
        )}

        {currentStep.kind === "expenses" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{t.operatorApp.submit.expensesTitle}</h1>
            {expenses.map((expense, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-card border border-border bg-card p-3">
                {selectedZoneIds.length > 1 && (
                  <select
                    className="h-10 rounded-control border border-border bg-muted px-2 text-sm"
                    value={expense.zoneId}
                    onChange={(e) => updateExpense(index, "zoneId", e.target.value)}
                  >
                    {selectedZoneIds.map((zoneId) => (
                      <option key={zoneId} value={zoneId}>
                        {zones.find((z) => z.id === zoneId)?.name}
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  inputMode="numeric"
                  placeholder={t.operatorApp.submit.amountPlaceholder}
                  className="h-14 rounded-control bg-muted text-lg font-bold tabular-nums"
                  value={expense.amount}
                  onChange={(e) => updateExpense(index, "amount", e.target.value)}
                />
                <Input
                  placeholder={t.operatorApp.submit.commentPlaceholder}
                  className="rounded-control bg-muted"
                  value={expense.comment}
                  onChange={(e) => updateExpense(index, "comment", e.target.value)}
                />
                <Button
                  variant="link"
                  className="h-auto w-fit gap-1 p-0 text-destructive"
                  onClick={() => removeExpense(index)}
                >
                  <Trash2 className="size-4" />
                  {t.common.delete}
                </Button>
              </div>
            ))}
            <PressableScale className="w-fit">
              <Button variant="outline" className="gap-2 rounded-control border-border" onClick={addExpense}>
                <Plus className="size-4" />
                {t.operatorApp.submit.addExpense}
              </Button>
            </PressableScale>
          </div>
        )}

        {currentStep.kind === "review" && (
          <div className="flex flex-col gap-3">
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{t.operatorApp.submit.reviewTitle}</h1>
            {selectedZoneIds.map((zoneId) => {
              const zone = zones.find((z) => z.id === zoneId)!;
              const preview = previewFor(zoneId);
              return (
                <div
                  key={zoneId}
                  className="flex flex-col gap-1 rounded-card border border-border bg-card p-3 text-body-airbnb"
                >
                  <span className="font-semibold">{zone.name}</span>
                  {preview && zone.accountingMode === "cash_only" && (
                    <span className="tabular-nums text-muted-foreground">
                      {t.operatorApp.submit.actualCash} {preview.actualCash.toFixed(2)}
                    </span>
                  )}
                  {preview && zone.accountingMode !== "cash_only" && (
                    <>
                      <span className="tabular-nums text-muted-foreground">
                        {t.operatorApp.submit.calculatedRevenue} {preview.calculatedRevenue.toFixed(2)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {t.operatorApp.submit.actualCash} {preview.actualCash.toFixed(2)}
                      </span>
                      <span className="tabular-nums font-semibold">
                        {t.operatorApp.submit.difference} {preview.difference > 0 ? "+" : ""}
                        {preview.difference.toFixed(2)}
                      </span>
                    </>
                  )}
                  {preview && preview.calculatedRevenue === 0 && preview.actualCash === 0 && (
                    <span className="mt-1 text-caption-airbnb text-warning">{t.operatorApp.submit.allZeroWarning}</span>
                  )}
                </div>
              );
            })}
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            <PressableScale>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="h-14 w-full gap-2 rounded-control font-bold"
              >
                <Send className="size-5" />
                {submitting ? t.operatorApp.submit.submitting : t.operatorApp.submit.submitButton}
              </Button>
            </PressableScale>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/90 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md gap-3">
          <PressableScale className="flex-1">
            <Button
              variant="outline"
              className="h-14 w-full gap-2 rounded-control border-border"
              onClick={goBack}
              disabled={stepIndex === 0}
            >
              <ChevronLeft className="size-5" />
              {t.common.back}
            </Button>
          </PressableScale>
          {currentStep.kind !== "review" && (
            <PressableScale className="flex-[1.6]">
              <Button
                className="h-14 w-full gap-2 rounded-control font-bold"
                onClick={goNext}
                disabled={currentStep.kind === "select" && selectedZoneIds.length === 0}
              >
                {t.common.next}
                {currentStep.kind === "zone" && activeZone?.accountingMode !== "cash_only" && (
                  <span className="text-xs font-semibold tabular-nums opacity-75">
                    {filledCount}/{activeZone?.assets.length ?? 0}
                  </span>
                )}
                <ChevronRight className="size-5" />
              </Button>
            </PressableScale>
          )}
        </div>
      </div>

      <BottomSheet open={counterAssetId !== null} onClose={() => setCounterAssetId(null)}>
        {activeZone && activeForm && activeAsset && (
          <div className="flex flex-col gap-4 pt-2">
            <div className="relative flex h-[150px] w-full items-center justify-center overflow-hidden rounded-card bg-muted">
              {activeAsset.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeAsset.photoUrl} alt="" className="size-full object-contain object-center" />
              ) : activeAsset.iconKey ? (
                <AssetOrZoneIcon iconKey={activeAsset.iconKey} className="size-10 text-muted-foreground" />
              ) : null}
              <span
                className="absolute left-3 top-3 size-4.5 rounded-full ring-[3px] ring-card"
                style={{ backgroundColor: activeAsset.colorTag }}
              />
            </div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{activeAsset.name}</h2>

            {activeZone.tariffs.map((tariff) => {
              const isLaunches = activeZone.accountingMode === "launches";
              const key = `${activeAsset.id}:${tariff.id}`;
              const value = activeForm.readings[key] ?? "";
              const previous = activeAsset.previousReadings[tariff.id] ?? 0;
              const parsed = value.trim() === "" ? null : Number(value);
              const invalid = value.trim() !== "" && (!Number.isFinite(parsed) || parsed! < 0 || parsed! > 9999);
              const rollover = !isLaunches && !invalid && parsed !== null && parsed < previous;
              const sessions = !invalid && parsed !== null ? (isLaunches ? parsed : calcSessions(parsed, previous)) : null;

              return (
                <div key={tariff.id} className="flex flex-col gap-1">
                  <Label htmlFor={key}>
                    {tariff.name}
                    {!isLaunches && (
                      <span className="font-normal text-muted-foreground">
                        {" "}· {t.operatorApp.submit.previousReading} {previous}
                      </span>
                    )}
                  </Label>
                  <Input
                    id={key}
                    autoFocus
                    inputMode="numeric"
                    placeholder="0–9999"
                    className="h-14 rounded-control bg-muted text-xl font-bold tabular-nums"
                    value={value}
                    onChange={(e) => updateReading(activeZone.id, key, e.target.value)}
                  />
                  {value.trim() !== "" && (
                    <p
                      className={cn(
                        "text-caption-airbnb font-semibold",
                        invalid || rollover ? "text-warning" : "text-primary"
                      )}
                    >
                      {invalid
                        ? t.operatorApp.submit.invalidNumberWarning
                        : isLaunches
                          ? `${t.operatorApp.submit.sessionsLabel} ${sessions}`
                          : `${t.operatorApp.submit.sessionsLabel} ${sessions}${
                              rollover ? " · " + t.operatorApp.submit.rolloverWarning : ""
                            }`}
                    </p>
                  )}
                </div>
              );
            })}

            <PressableScale>
              <Button className="w-full rounded-control font-bold" onClick={() => setCounterAssetId(null)}>
                {t.common.save}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      <ImageLightbox src={lightboxUrl} />
    </div>
  );
}
