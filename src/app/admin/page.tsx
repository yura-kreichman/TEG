"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { StatusChip } from "@/components/status-chip";
import { useI18n } from "@/components/i18n-provider";

type SubscriptionStatus = "trialing" | "active" | "paused" | "expired";

interface TenantInfo {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  trialEndsAt: string | null;
  package: { id: string; name: string };
  pointsCount: number;
  operatorsCount: number;
}

const EXPIRING_SOON_DAYS = 7;

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const days = (new Date(dateStr).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}

export default function AdminTenantsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);

  useEffect(() => {
    fetch("/api/admin/tenants")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/admin/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setTenants(data.tenants ?? []);
        setChecking(false);
      });
  }, [router]);

  if (checking) return null;

  const statusVariant: Record<SubscriptionStatus, "accent" | "warning" | "neutral"> = {
    trialing: "accent",
    active: "accent",
    paused: "warning",
    expired: "neutral",
  };
  const statusLabel: Record<SubscriptionStatus, string> = {
    trialing: t.admin.statusTrialing,
    active: t.admin.statusActive,
    paused: t.admin.statusPaused,
    expired: t.admin.statusExpired,
  };

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <h1 className="text-screen-title">{t.admin.tenantsTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.admin.tenantsSub}</p>

          {tenants.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.admin.noTenants}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3">
              {tenants.map((tenant) => (
                <StaggerItem key={tenant.id}>
                  <SpringCard animate={false}>
                    <Link href={`/admin/tenants/${tenant.id}`} className="flex items-center gap-3">
                      <div className="min-w-0 grow">
                        <div className="flex items-center gap-2">
                          <div className="text-card-title">{tenant.name}</div>
                          <StatusChip variant={statusVariant[tenant.subscriptionStatus]}>
                            {statusLabel[tenant.subscriptionStatus]}
                          </StatusChip>
                          {(isExpiringSoon(tenant.subscriptionExpiresAt) || isExpiringSoon(tenant.trialEndsAt)) && (
                            <StatusChip variant="warning">{t.admin.expiringSoonChip}</StatusChip>
                          )}
                        </div>
                        <p className="text-caption-airbnb">
                          {tenant.package.name} · {tenant.pointsCount} {t.admin.pointsSuffix} ·{" "}
                          {tenant.operatorsCount} {t.admin.operatorsSuffix}
                        </p>
                      </div>
                      <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
