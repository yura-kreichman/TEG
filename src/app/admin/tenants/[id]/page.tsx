"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

type SubscriptionStatus = "active" | "paused" | "suspended" | "expired";

interface HistoryEntry {
  id: string;
  correctedAt: string;
  correctedByEmail: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  comment: string | null;
}

interface BillingEvent {
  id: string;
  eventType: string;
  status: string;
  error: string | null;
  receivedAt: string;
}

interface PackageOption {
  id: string;
  name: string;
  maxPoints: number;
  maxZones: number;
  maxAssets: number;
  maxOperators: number;
}

type LimitKey = "maxPoints" | "maxZones" | "maxAssets" | "maxOperators";

interface TenantDetail {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  contactPhone: string | null;
  adminNote: string | null;
  ownerEmail: string | null;
  package: PackageOption;
  fluentcartCustomerId: string | null;
  limitOverrides: Partial<Record<LimitKey, number>>;
  usage: { points: number; zones: number; assets: number; operators: number };
  history: HistoryEntry[];
  billingHistory: BillingEvent[];
}

const LIMIT_KEYS: LimitKey[] = ["maxPoints", "maxZones", "maxAssets", "maxOperators"];

export default function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const t = useI18n();

  const [checking, setChecking] = useState(true);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);

  const [fluentcartInput, setFluentcartInput] = useState("");
  const [subscriptionExpiresAtInput, setSubscriptionExpiresAtInput] = useState("");
  const [limitForm, setLimitForm] = useState<Record<LimitKey, string>>({
    maxPoints: "",
    maxZones: "",
    maxAssets: "",
    maxOperators: "",
  });
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  async function load() {
    const [tenantRes, packagesRes] = await Promise.all([
      fetch(`/api/admin/tenants/${id}`),
      fetch("/api/admin/packages"),
    ]);
    if (tenantRes.status === 401) {
      router.replace("/admin/login");
      return;
    }
    if (tenantRes.status === 404) {
      router.replace("/admin");
      return;
    }
    const tenantData: TenantDetail = await tenantRes.json();
    const packagesData = await packagesRes.json();
    setTenant(tenantData);
    setPackages(packagesData.packages ?? []);
    setFluentcartInput(tenantData.fluentcartCustomerId ?? "");
    setSubscriptionExpiresAtInput(tenantData.subscriptionExpiresAt ? tenantData.subscriptionExpiresAt.slice(0, 10) : "");
    setLimitForm({
      maxPoints: tenantData.limitOverrides.maxPoints !== undefined ? String(tenantData.limitOverrides.maxPoints) : "",
      maxZones: tenantData.limitOverrides.maxZones !== undefined ? String(tenantData.limitOverrides.maxZones) : "",
      maxAssets: tenantData.limitOverrides.maxAssets !== undefined ? String(tenantData.limitOverrides.maxAssets) : "",
      maxOperators:
        tenantData.limitOverrides.maxOperators !== undefined ? String(tenantData.limitOverrides.maxOperators) : "",
    });
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function patch(body: Record<string, unknown>) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function updateStatus(subscriptionStatus: SubscriptionStatus) {
    await patch({ subscriptionStatus });
  }

  async function updatePackage(packageId: string) {
    await patch({ packageId });
  }

  async function updateSubscriptionExpiresAt(value: string) {
    await patch({ subscriptionExpiresAt: value || null });
  }

  async function updateTextField(field: "contactPhone" | "adminNote", value: string) {
    await patch({ [field]: value || null });
  }

  async function saveFluentcartId() {
    await patch({ fluentcartCustomerId: fluentcartInput || null });
  }

  async function unlinkFluentcart() {
    setFluentcartInput("");
    await patch({ fluentcartCustomerId: null });
  }

  async function saveLimitOverrides(next: Record<LimitKey, string>) {
    const built: Partial<Record<LimitKey, number>> = {};
    for (const key of LIMIT_KEYS) {
      const raw = next[key].trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) built[key] = value;
    }
    await patch({ limitOverrides: Object.keys(built).length > 0 ? built : null });
  }

  function updateLimitField(key: LimitKey, value: string) {
    setLimitForm((prev) => {
      const next = { ...prev, [key]: value };
      saveLimitOverrides(next);
      return next;
    });
  }

  async function impersonate() {
    setImpersonateError(null);
    const res = await fetch(`/api/admin/tenants/${id}/impersonate`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setImpersonateError(data.error ?? t.admin.genericError);
      return;
    }
    window.location.href = "/";
  }

  if (checking || !tenant) return null;

  const statusOptions: { value: SubscriptionStatus; label: string }[] = [
    { value: "active", label: t.admin.statusActive },
    { value: "paused", label: t.admin.statusPaused },
    { value: "suspended", label: t.admin.statusSuspended },
    { value: "expired", label: t.admin.statusExpired },
  ];

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.push("/admin")}
              className="flex w-fit items-center gap-1 text-caption-airbnb font-semibold text-primary"
            >
              <ChevronLeft className="size-4" />
              {t.admin.backToTenants}
            </button>
            <Button variant="outline" size="sm" onClick={impersonate}>
              {t.admin.impersonateButton}
            </Button>
          </div>
          {impersonateError && <p className="text-sm text-destructive">{impersonateError}</p>}

          <h1 className="text-screen-title">{tenant.name}</h1>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.subscriptionTitle}</div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label>{t.admin.statusLabel}</Label>
                  <Select
                    value={tenant.subscriptionStatus}
                    onValueChange={(v) => v && updateStatus(v as SubscriptionStatus)}
                    items={statusOptions}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label>{t.admin.packageLabel}</Label>
                  <Select
                    value={tenant.package.id}
                    onValueChange={(v) => v && updatePackage(v)}
                    items={packages.map((p) => ({ value: p.id, label: p.name }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {packages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="subscriptionExpiresAt">{t.admin.subscriptionExpiresLabel}</Label>
                  <Input
                    id="subscriptionExpiresAt"
                    type="date"
                    value={subscriptionExpiresAtInput}
                    onChange={(e) => setSubscriptionExpiresAtInput(e.target.value)}
                    onBlur={(e) => updateSubscriptionExpiresAt(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-caption-airbnb">{t.admin.expiryHint}</p>
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-1 text-card-title">{t.admin.fluentcartTitle}</div>
            <p className="mb-3 text-caption-airbnb">{t.admin.fluentcartHint}</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fluentcartId">{t.admin.fluentcartIdLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id="fluentcartId"
                  value={fluentcartInput}
                  onChange={(e) => setFluentcartInput(e.target.value)}
                  onBlur={saveFluentcartId}
                  placeholder={t.admin.fluentcartIdPlaceholder}
                  className="flex-1"
                />
                {tenant.fluentcartCustomerId && (
                  <Button type="button" variant="outline" onClick={unlinkFluentcart}>
                    {t.admin.unlinkButton}
                  </Button>
                )}
              </div>
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.contactsTitle}</div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label>{t.admin.ownerEmailLabel}</Label>
                <p className="text-body-airbnb">{tenant.ownerEmail ?? "—"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="contactPhone">{t.admin.contactPhoneLabel}</Label>
                <Input
                  id="contactPhone"
                  type="tel"
                  defaultValue={tenant.contactPhone ?? ""}
                  onBlur={(e) => updateTextField("contactPhone", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="adminNote">{t.admin.adminNoteLabel}</Label>
                <Textarea
                  id="adminNote"
                  rows={3}
                  placeholder={t.admin.adminNotePlaceholder}
                  defaultValue={tenant.adminNote ?? ""}
                  onBlur={(e) => updateTextField("adminNote", e.target.value)}
                />
              </div>
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.tenantUsageTitle}</div>
            <div className="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-4">
              {(
                [
                  [t.admin.usagePoints, tenant.usage.points, "maxPoints", tenant.package.maxPoints],
                  [t.admin.usageZones, tenant.usage.zones, "maxZones", tenant.package.maxZones],
                  [t.admin.usageAssets, tenant.usage.assets, "maxAssets", tenant.package.maxAssets],
                  [t.admin.usageOperators, tenant.usage.operators, "maxOperators", tenant.package.maxOperators],
                ] as const
              ).map(([label, used, key, packageMax]) => {
                const override = tenant.limitOverrides[key];
                const effectiveMax = override ?? packageMax;
                const delta = override !== undefined ? override - packageMax : 0;
                return (
                  <div key={label}>
                    <div className="text-caption-airbnb">{label}</div>
                    <div className="text-[16px] font-bold">
                      {used} <span className="text-muted-foreground">/ {effectiveMax}</span>
                      {delta !== 0 && (
                        <span className="ml-1 text-caption-airbnb font-semibold text-primary">
                          ({delta > 0 ? "+" : ""}
                          {delta})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-1 text-card-title">{t.admin.limitOverridesTitle}</div>
            <p className="mb-3 text-caption-airbnb">{t.admin.limitOverridesHint}</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["maxPoints", t.admin.maxPointsLabel, tenant.package.maxPoints],
                  ["maxZones", t.admin.maxZonesLabel, tenant.package.maxZones],
                  ["maxAssets", t.admin.maxAssetsLabel, tenant.package.maxAssets],
                  ["maxOperators", t.admin.maxOperatorsLabel, tenant.package.maxOperators],
                ] as const
              ).map(([key, label, packageDefault]) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`limit-${key}`}>{label}</Label>
                  <Input
                    id={`limit-${key}`}
                    inputMode="numeric"
                    className="tabular-nums"
                    placeholder={String(packageDefault)}
                    value={limitForm[key]}
                    onChange={(e) => setLimitForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    onBlur={(e) => updateLimitField(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </SpringCard>

          {tenant.billingHistory.length > 0 && (
            <SpringCard animate={false}>
              <div className="mb-1 text-card-title">{t.admin.billingHistoryTitle}</div>
              <div className="flex flex-col">
                {tenant.billingHistory.map((ev) => (
                  <div key={ev.id} className="border-t border-border py-3 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-caption-airbnb font-semibold">{ev.eventType}</span>
                      <span className="text-caption-airbnb">{new Date(ev.receivedAt).toLocaleString()}</span>
                    </div>
                    <p className={cn("text-body-airbnb", ev.status === "failed" && "text-destructive")}>
                      {ev.status === "failed" ? t.admin.billingEventFailed : t.admin.billingEventProcessed}
                    </p>
                    {ev.error && <p className="text-caption-airbnb italic">{ev.error}</p>}
                  </div>
                ))}
              </div>
            </SpringCard>
          )}

          {tenant.history.length > 0 && (
            <SpringCard animate={false}>
              <div className="mb-1 text-card-title">{t.admin.historyTitle}</div>
              <div className="flex flex-col">
                {tenant.history.map((h) => (
                  <div key={h.id} className="border-t border-border py-3 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-caption-airbnb font-semibold">{h.correctedByEmail}</span>
                      <span className="text-caption-airbnb">{new Date(h.correctedAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5 text-body-airbnb">
                      {describeHistoryChanges(h, packages, statusOptions).map((line, i) => (
                        <span key={i}>{line}</span>
                      ))}
                    </div>
                    {h.comment && <p className="mt-1 text-caption-airbnb italic">{h.comment}</p>}
                  </div>
                ))}
              </div>
            </SpringCard>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function describeHistoryChanges(
  entry: HistoryEntry,
  packages: PackageOption[],
  statusOptions: { value: SubscriptionStatus; label: string }[]
): string[] {
  const packageName = (id: unknown) => packages.find((p) => p.id === id)?.name ?? String(id);
  const statusName = (v: unknown) => statusOptions.find((o) => o.value === v)?.label ?? String(v);
  const dateName = (v: unknown) => (v ? new Date(v as string).toLocaleDateString() : "—");

  const lines: string[] = [];
  for (const key of Object.keys(entry.after)) {
    const beforeVal = entry.before[key];
    const afterVal = entry.after[key];
    if (key === "packageId") lines.push(`${packageName(beforeVal)} → ${packageName(afterVal)}`);
    else if (key === "subscriptionStatus") lines.push(`${statusName(beforeVal)} → ${statusName(afterVal)}`);
    else if (key === "subscriptionExpiresAt" || key === "trialEndsAt") lines.push(`${dateName(beforeVal)} → ${dateName(afterVal)}`);
    else if (key === "contactPhone" || key === "adminNote" || key === "fluentcartCustomerId") {
      lines.push(`${beforeVal ?? "—"} → ${afterVal ?? "—"}`);
    } else if (key === "manualStatusOverride" || key === "limitOverrides") {
      lines.push(`${key}: ${afterVal ? JSON.stringify(afterVal) : "—"}`);
    }
  }
  return lines;
}
