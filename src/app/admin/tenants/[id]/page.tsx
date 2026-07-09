"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/i18n-provider";
import { MODULE_KEYS } from "@/lib/module-keys";

type SubscriptionStatus = "trialing" | "active" | "paused" | "expired";

interface HistoryEntry {
  id: string;
  correctedAt: string;
  correctedByEmail: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  comment: string | null;
}

interface PackageOption {
  id: string;
  name: string;
  modules: string[];
  maxPoints: number;
  maxZones: number;
  maxAssets: number;
  maxOperators: number;
}

interface TenantDetail {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  trialEndsAt: string | null;
  contactPhone: string | null;
  adminNote: string | null;
  ownerEmail: string | null;
  package: PackageOption;
  moduleFlags: { moduleKey: string; enabled: boolean }[];
  usage: { points: number; zones: number; assets: number; operators: number };
  history: HistoryEntry[];
}

export default function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const t = useI18n();

  const [checking, setChecking] = useState(true);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);

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
    const tenantData = await tenantRes.json();
    const packagesData = await packagesRes.json();
    setTenant(tenantData);
    setPackages(packagesData.packages ?? []);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function updateStatus(subscriptionStatus: SubscriptionStatus) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionStatus }),
    });
    await load();
  }

  async function updatePackage(packageId: string) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    await load();
  }

  async function updateDateField(field: "subscriptionExpiresAt" | "trialEndsAt", value: string) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    await load();
  }

  async function updateTextField(field: "contactPhone" | "adminNote", value: string) {
    await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    await load();
  }

  async function toggleModule(moduleKey: string, enabled: boolean) {
    await fetch(`/api/admin/tenants/${id}/modules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKey, enabled }),
    });
    await load();
  }

  async function resetModule(moduleKey: string) {
    await fetch(`/api/admin/tenants/${id}/modules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKey }),
    });
    await load();
  }

  if (checking || !tenant) return null;

  const statusOptions: { value: SubscriptionStatus; label: string }[] = [
    { value: "trialing", label: t.admin.statusTrialing },
    { value: "active", label: t.admin.statusActive },
    { value: "paused", label: t.admin.statusPaused },
    { value: "expired", label: t.admin.statusExpired },
  ];

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="flex w-fit items-center gap-1 text-caption-airbnb font-semibold text-primary"
          >
            <ChevronLeft className="size-4" />
            {t.admin.backToTenants}
          </button>

          <h1 className="text-screen-title">{tenant.name}</h1>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.subscriptionTitle}</div>
            <div className="flex flex-col gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="trialEndsAt">{t.admin.trialEndsLabel}</Label>
                  <Input
                    id="trialEndsAt"
                    type="date"
                    defaultValue={tenant.trialEndsAt ? tenant.trialEndsAt.slice(0, 10) : ""}
                    onBlur={(e) => updateDateField("trialEndsAt", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="subscriptionExpiresAt">{t.admin.subscriptionExpiresLabel}</Label>
                  <Input
                    id="subscriptionExpiresAt"
                    type="date"
                    defaultValue={tenant.subscriptionExpiresAt ? tenant.subscriptionExpiresAt.slice(0, 10) : ""}
                    onBlur={(e) => updateDateField("subscriptionExpiresAt", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-caption-airbnb">{t.admin.expiryHint}</p>
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
                  [t.admin.usagePoints, tenant.usage.points, tenant.package.maxPoints],
                  [t.admin.usageZones, tenant.usage.zones, tenant.package.maxZones],
                  [t.admin.usageAssets, tenant.usage.assets, tenant.package.maxAssets],
                  [t.admin.usageOperators, tenant.usage.operators, tenant.package.maxOperators],
                ] as const
              ).map(([label, used, max]) => (
                <div key={label}>
                  <div className="text-caption-airbnb">{label}</div>
                  <div className="text-[16px] font-bold">
                    {used} <span className="text-muted-foreground">/ {max}</span>
                  </div>
                </div>
              ))}
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-1 text-card-title">{t.admin.moduleOverridesTitle}</div>
            <p className="mb-3 text-caption-airbnb">{t.admin.moduleOverridesHint}</p>
            <div className="flex flex-col">
              {MODULE_KEYS.map((key) => {
                const override = tenant.moduleFlags.find((m) => m.moduleKey === key);
                const packageDefault = tenant.package.modules.includes(key);
                const effective = override ? override.enabled : packageDefault;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0"
                  >
                    <div>
                      <div className="text-body-airbnb font-semibold">
                        {t.admin.moduleNames[key as keyof typeof t.admin.moduleNames]}
                      </div>
                      <div className="text-caption-airbnb">
                        {override
                          ? override.enabled
                            ? t.admin.moduleEnabled
                            : t.admin.moduleDisabled
                          : t.admin.moduleDefault}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {override && (
                        <button
                          type="button"
                          onClick={() => resetModule(key)}
                          className="text-caption-airbnb font-semibold text-primary underline underline-offset-2"
                        >
                          {t.admin.resetOverride}
                        </button>
                      )}
                      <Switch
                        checked={effective}
                        onCheckedChange={(checked) => toggleModule(key, checked)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </SpringCard>

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
    else if (key === "contactPhone" || key === "adminNote") {
      lines.push(`${beforeVal ?? "—"} → ${afterVal ?? "—"}`);
    }
  }
  return lines;
}
