"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, ImagePlus, KeyRound, LogOut, Pencil } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/components/i18n-provider";
import type { Dictionary } from "@/lib/i18n";
import { PressableScale } from "@/components/motion/pressable-scale";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { SpringCard } from "@/components/spring-card";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { AuthLocalePicker } from "@/components/auth-locale-picker";
import { cn } from "@/lib/utils";
import { compressImageFile } from "@/lib/client-image";
import { PRICING_URL } from "@/lib/billing";
import { useSlugPreview } from "@/lib/use-slug-preview";

function formatRelativeDay(dateStr: string, isToday: boolean, t: Dictionary): string {
  if (isToday) return t.home.today;
  const d = new Date(`${dateStr}T00:00:00Z`);
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const diffDays = Math.round((todayUTC - d.getTime()) / 86400000);
  const readable = `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]}`;
  return diffDays === 1 ? `${t.home.yesterday}, ${readable}` : readable;
}

export function WelcomeCard() {
  const t = useI18n();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 bg-surface-0 px-4 pb-16">
      {/* Стеклянный блик по логотипу главного экрана — виден только здесь
          (первый экран приветствия), на AuthCard логотип статичный.
          Клип по rounded-[10%] повторяет скругление самого артворка
          (rx=55.01 на viewBox 546.99 в RentOS-icon.svg), чтобы блик не
          вылезал за силуэт иконки прямоугольными углами. */}
      <div className="relative size-24 overflow-hidden rounded-[10%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-library/pwa/RentOS-icon.svg" alt="" className="size-full" />
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, transparent 25%, rgba(255,255,255,0.35) 50%, transparent 75%)",
          }}
          initial={{ x: "-130%" }}
          animate={{ x: "130%" }}
          transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity, repeatDelay: 5.2 }}
        />
      </div>
      <AuthLocalePicker />
      <div className="w-full max-w-sm">
        <SpringCard>
          <StaggerList className="flex flex-col gap-4">
            <StaggerItem>
              <h1 className="text-screen-title">{t.home.welcomeTitle}</h1>
              <p className="mt-1 text-body-airbnb text-muted-foreground">{t.home.welcomeHint}</p>
            </StaggerItem>
            <StaggerItem>
              <PressableScale>
                <Link href="/login" className={cn(buttonVariants(), "w-full")}>
                  {t.home.login}
                </Link>
              </PressableScale>
            </StaggerItem>
            <StaggerItem>
              <Link
                href="/register"
                className="block text-center text-body-airbnb underline underline-offset-2"
              >
                {t.home.createAccount}
              </Link>
            </StaggerItem>
          </StaggerList>
        </SpringCard>
      </div>
      {mounted && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={
            resolvedTheme === "dark"
              ? "/icon-library/pwa/RentOS365-dark.svg"
              : "/icon-library/pwa/RentOS365-light.svg"
          }
          alt="RentOS365"
          className="absolute bottom-4 h-6 w-auto"
        />
      )}
    </div>
  );
}

interface Summary {
  hasData: boolean;
  date?: string;
  isToday?: boolean;
  revenue?: number;
  profit?: number;
  submissionsCount?: number;
  difference?: number;
}

interface Usage {
  packageName: string;
  subscriptionStatus: "active" | "paused" | "suspended" | "expired";
  subscriptionExpiresAt: string | null;
  currentPeriodEnd: string | null;
  points: { used: number; max: number; packageMax: number };
  operators: { used: number; max: number; packageMax: number };
  zones: { used: number; max: number; packageMax: number };
  assets: { used: number; max: number; packageMax: number };
}

export function OwnerDashboardCard({
  email,
  tenantName,
  tenantLogoUrl,
  hasPin,
}: {
  email: string;
  tenantName: string | null;
  tenantLogoUrl: string | null;
  hasPin: boolean;
}) {
  const t = useI18n();
  const router = useRouter();

  const [companyName, setCompanyName] = useState(tenantName ?? "");
  const [logoUrl, setLogoUrl] = useState(tenantLogoUrl);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const [accountView, setAccountView] = useState<"menu" | "rename" | null>(null);
  const [renameValue, setRenameValue] = useState(tenantName ?? "");
  const [updateSlugOnRename, setUpdateSlugOnRename] = useState(false);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const renameSlugPreview = useSlugPreview(renameValue);
  const nameChanged = renameValue.trim() !== companyName.trim() && renameValue.trim().length > 0;

  useEffect(() => {
    fetch("/api/tenant/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.slug && setCurrentSlug(data.slug));
  }, []);

  useEffect(() => {
    fetch("/api/reports/home-summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setSummary(data));
    fetch("/api/tenant/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setUsage(data));
  }, []);

  function openAccountMenu() {
    setAccountView("menu");
    setRenameValue(companyName);
    setUpdateSlugOnRename(false);
    setAccountError(null);
  }

  async function confirmRename() {
    if (!renameValue.trim()) return;
    const res = await fetch("/api/tenant/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue, updateSlug: nameChanged && updateSlugOnRename }),
    });
    if (!res.ok) {
      const data = await res.json();
      setAccountError(data.error ?? "Не удалось сохранить название");
      return;
    }
    const data = await res.json();
    if (data.slug) setCurrentSlug(data.slug);
    setCompanyName(renameValue.trim());
    setAccountView(null);
  }

  async function handleUploadLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const compressed = await compressImageFile(file, { maxDimension: 640, maxBytes: 120 * 1024 });
      const formData = new FormData();
      formData.append("file", compressed);
      const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) return;
      await fetch("/api/tenant/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: uploadData.url }),
      });
      setLogoUrl(uploadData.url);
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
      setAccountView(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const planStatusLabel =
    usage?.subscriptionStatus === "paused"
      ? t.home.planStatusPaused
      : usage?.subscriptionStatus === "expired"
        ? t.home.planStatusExpired
        : usage?.subscriptionStatus === "suspended"
          ? t.home.planStatusSuspended
          : t.home.planStatusActive;

  const planStatusIsWarning =
    usage?.subscriptionStatus === "paused" ||
    usage?.subscriptionStatus === "expired" ||
    usage?.subscriptionStatus === "suspended";

  const planEndDate = usage?.subscriptionExpiresAt;

  return (
    <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-3.5">
        {/* Приветствие */}
        <SpringCard hover={false} className="flex items-center gap-3.5">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-card bg-primary text-2xl font-extrabold text-primary-foreground">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-full object-cover" />
            ) : (
              companyName.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0 grow">
            <p className="text-caption-airbnb">{t.home.greeting}</p>
            <p className="text-card-title truncate">{companyName}</p>
            <p className="text-caption-airbnb truncate">{email}</p>
          </div>
          <KebabButton onClick={openAccountMenu} label={t.home.accountActionsLabel} />
        </SpringCard>

        {!hasPin && (
          <div className="rounded-control border border-warning/40 bg-warning/10 p-3 text-body-airbnb text-foreground">
            {t.home.pinNotSet}{" "}
            <Link href="/set-pin" className="underline underline-offset-2">
              {t.home.setPinNow}
            </Link>
          </div>
        )}

        {/* Последние итоги */}
        {summary?.hasData && (
          <SpringCard hover={false} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <p className="text-section-title">
                {t.home.latestResultsLabel} · {formatRelativeDay(summary.date!, summary.isToday!, t)}
              </p>
              <Link href="/money" className="flex items-center gap-0.5 text-caption-airbnb font-semibold text-primary">
                {t.home.toMoneyLink}
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[32px] font-extrabold tracking-[-0.02em]">
                {summary.revenue!.toFixed(2)}
              </span>
              <span className="text-caption-airbnb">{t.home.revenueUnit}</span>
            </div>
            <div className="flex border-t border-border pt-3 tabular-nums">
              <div className="flex-1">
                <p className="text-caption-airbnb">{t.money.profit}</p>
                <p className="text-[16px] font-bold text-primary">
                  {summary.profit! > 0 ? "+" : ""}
                  {summary.profit!.toFixed(2)}
                </p>
              </div>
              <div className="flex-1 border-l border-border pl-4">
                <p className="text-caption-airbnb">{t.home.submissionsCountLabel}</p>
                <p className="text-[16px] font-bold">{summary.submissionsCount}</p>
              </div>
              <div className="flex-1 border-l border-border pl-4">
                <p className="text-caption-airbnb">{t.home.differenceLabel}</p>
                <p className="text-[16px] font-bold text-primary">
                  {summary.difference! > 0 ? "+" : ""}
                  {summary.difference!.toFixed(2)}
                </p>
              </div>
            </div>
            {!summary.isToday && (
              <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-caption-airbnb">
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                {t.home.noSubmissionsTodayNote}
              </p>
            )}
          </SpringCard>
        )}
        {summary && !summary.hasData && (
          <SpringCard hover={false}>
            <p className="text-body-airbnb text-muted-foreground">{t.home.noDataYet}</p>
          </SpringCard>
        )}

        {/* Навигация */}
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

        {/* Тариф */}
        {usage && (
          <SpringCard hover={false} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-section-title">{t.home.planCardLabel}</p>
                <p className="text-card-title">{usage.packageName}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                    planStatusIsWarning ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", planStatusIsWarning ? "bg-warning" : "bg-primary")} />
                  {planStatusLabel}
                </span>
                {planEndDate ? (
                  <p className="text-caption-airbnb whitespace-nowrap">
                    {t.home.planExpiresPrefix} {new Date(planEndDate).toLocaleDateString()}
                  </p>
                ) : (
                  usage.currentPeriodEnd &&
                  usage.subscriptionStatus === "active" && (
                    <p className="text-caption-airbnb whitespace-nowrap text-muted-foreground">
                      {t.home.nextBillingPrefix} {new Date(usage.currentPeriodEnd).toLocaleDateString()}
                    </p>
                  )
                )}
              </div>
            </div>

            {(
              [
                [t.home.limitPoints, usage.points],
                [t.home.limitOperators, usage.operators],
                [t.home.limitZones, usage.zones],
                [t.home.limitAssets, usage.assets],
              ] as const
            ).map(([label, { used, max, packageMax }]) => (
              <div key={label} className="mt-2.5 tabular-nums">
                <div className="mb-1 flex justify-between text-caption-airbnb">
                  <span>{label}</span>
                  <span className="font-semibold text-foreground">
                    {used} {t.common.of} {max}
                    {max > packageMax && <span className="text-primary"> (+{max - packageMax})</span>}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-0">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (used / Math.max(max, 1)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}

            <a
              href={PRICING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 text-caption-airbnb font-semibold text-primary"
            >
              {t.home.manageSubscriptionLink}
            </a>
          </SpringCard>
        )}
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleUploadLogo}
      />

      <BottomSheet open={accountView === "menu"} onClose={() => setAccountView(null)}>
        <div className="pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{companyName}</h2>
          <p className="mb-2 text-caption-airbnb">{email}</p>
          <ActionSheetItem icon={Pencil} onClick={() => setAccountView("rename")}>
            {t.home.renameCompanyAction}
          </ActionSheetItem>
          <ActionSheetItem icon={ImagePlus} onClick={() => logoInputRef.current?.click()}>
            {logoUploading ? t.zoneDetail.uploading : t.home.uploadLogoAction}
          </ActionSheetItem>
          <ActionSheetItem icon={KeyRound} onClick={() => router.push("/set-pin")}>
            {t.home.changePin}
          </ActionSheetItem>
          <ActionSheetItem icon={LogOut} destructive onClick={handleLogout}>
            {t.home.logoutAction}
          </ActionSheetItem>
        </div>
      </BottomSheet>

      <BottomSheet open={accountView === "rename"} onClose={() => setAccountView(null)}>
        <div className="flex flex-col gap-3 pt-2">
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.home.renameCompanyTitle}</h2>
            <p className="text-caption-airbnb">{t.home.renameCompanyHint}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="companyName">{t.auth.companyNameLabel}</Label>
            <Input id="companyName" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
            {currentSlug && !nameChanged && (
              <p className="text-caption-airbnb text-muted-foreground">
                {t.auth.slugPreviewPrefix} my.rentos365.app/s/{currentSlug}
              </p>
            )}
          </div>
          <p className="text-caption-airbnb text-muted-foreground">{t.home.renameCompanySlugWarning}</p>
          {nameChanged && (
            <div className="flex flex-col gap-2 rounded-control border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-airbnb">{t.home.updateSlugCheckboxLabel}</span>
                <Switch checked={updateSlugOnRename} onCheckedChange={setUpdateSlugOnRename} />
              </div>
              {updateSlugOnRename && renameSlugPreview && (
                <p className="text-caption-airbnb text-muted-foreground">
                  {t.auth.slugPreviewPrefix} my.rentos365.app/s/{renameSlugPreview}
                </p>
              )}
              <p className="text-caption-airbnb text-muted-foreground">{t.home.updateSlugHint}</p>
            </div>
          )}
          {accountError && <p className="text-sm text-destructive">{accountError}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAccountView("menu")}>
              {t.common.cancel}
            </Button>
            <PressableScale className="flex-1">
              <SaveButton className="w-full" onClick={confirmRename}>
              {t.common.save}
              </SaveButton>
            </PressableScale>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
