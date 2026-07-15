"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ActionSheetItem, KebabButton } from "@/components/kebab-menu";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface PackageInfo {
  id: string;
  name: string;
  maxPoints: number;
  maxZones: number;
  maxAssets: number;
  maxOperators: number;
  priceMonthly: string;
  fluentcartProductId: string | null;
  tenantsCount: number;
}

const EMPTY_FORM = {
  name: "",
  maxPoints: "5",
  maxZones: "10",
  maxAssets: "50",
  maxOperators: "10",
  priceMonthly: "0",
  fluentcartProductId: "",
};

export default function AdminPackagesPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [packages, setPackages] = useState<PackageInfo[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { saved, pulse } = useSavePulse();

  const [kebab, setKebab] = useState<PackageInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/packages");
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    const data = await res.json();
    setPackages(data.packages ?? []);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setEditorOpen(true);
  }

  function openEdit(pkg: PackageInfo) {
    setKebab(null);
    setEditingId(pkg.id);
    setForm({
      name: pkg.name,
      maxPoints: String(pkg.maxPoints),
      maxZones: String(pkg.maxZones),
      maxAssets: String(pkg.maxAssets),
      maxOperators: String(pkg.maxOperators),
      priceMonthly: pkg.priceMonthly,
      fluentcartProductId: pkg.fluentcartProductId ?? "",
    });
    setSaveError(null);
    setEditorOpen(true);
  }

  async function save() {
    const payload = {
      name: form.name.trim(),
      maxPoints: Number(form.maxPoints),
      maxZones: Number(form.maxZones),
      maxAssets: Number(form.maxAssets),
      maxOperators: Number(form.maxOperators),
      priceMonthly: Number(form.priceMonthly),
      fluentcartProductId: form.fluentcartProductId.trim() || null,
    };
    const res = await fetch(editingId ? `/api/admin/packages/${editingId}` : "/api/admin/packages", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      setSaveError(data.error ?? t.admin.genericError);
      return;
    }
    await load();
    pulse(() => setEditorOpen(false));
  }

  async function deletePackage() {
    if (!kebab) return;
    setDeleteError(null);
    const res = await fetch(`/api/admin/packages/${kebab.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setDeleteError(data.error ?? t.admin.genericError);
      return;
    }
    setKebab(null);
    setConfirmDelete(false);
    await load();
  }

  if (checking) return null;

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.admin.packagesTitle}</h1>
            <PressableScale>
              <Button variant="dark" size="sm" className="gap-1.5" onClick={openCreate}>
                <Plus className="size-4" />
                {t.admin.addPackage}
              </Button>
            </PressableScale>
          </div>
          <p className="mb-4 text-caption-airbnb">{t.admin.packagesSub}</p>

          {packages.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.admin.noPackages}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3">
              {packages.map((pkg) => (
                <StaggerItem key={pkg.id}>
                  <SpringCard animate={false}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 grow">
                        <div className="text-card-title">{pkg.name}</div>
                        <p className="text-caption-airbnb tabular-nums">
                          {pkg.priceMonthly} · {pkg.maxPoints} {t.admin.usagePoints.toLowerCase()} · {pkg.maxOperators}{" "}
                          {t.admin.usageOperators.toLowerCase()} · {pkg.tenantsCount} {t.admin.tenantsCountSuffix}
                        </p>
                        {!pkg.fluentcartProductId && (
                          <p className="mt-0.5 text-caption-airbnb text-warning">{t.admin.notLinkedChip}</p>
                        )}
                      </div>
                      <KebabButton
                        onClick={() => {
                          setKebab(pkg);
                          setConfirmDelete(false);
                          setDeleteError(null);
                        }}
                        label={t.admin.editPackage}
                      />
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={editorOpen} onClose={() => setEditorOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {editingId ? t.admin.editPackageTitle : t.admin.newPackageTitle}
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pkg-name">{t.admin.nameFieldLabel}</Label>
            <Input
              id="pkg-name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pkg-fluentcart">{t.admin.productIdFieldLabel}</Label>
            <Input
              id="pkg-fluentcart"
              placeholder={t.admin.productIdFieldPlaceholder}
              value={form.fluentcartProductId}
              onChange={(e) => setForm((p) => ({ ...p, fluentcartProductId: e.target.value }))}
            />
            <p className="text-caption-airbnb text-muted-foreground">{t.admin.productIdFieldHint}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pkg-price">{t.admin.priceFieldLabel}</Label>
            <Input
              id="pkg-price"
              inputMode="decimal"
              className="tabular-nums"
              value={form.priceMonthly}
              onChange={(e) => setForm((p) => ({ ...p, priceMonthly: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pkg-points">{t.admin.maxPointsLabel}</Label>
              <Input
                id="pkg-points"
                inputMode="numeric"
                className="tabular-nums"
                value={form.maxPoints}
                onChange={(e) => setForm((p) => ({ ...p, maxPoints: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pkg-zones">{t.admin.maxZonesLabel}</Label>
              <Input
                id="pkg-zones"
                inputMode="numeric"
                className="tabular-nums"
                value={form.maxZones}
                onChange={(e) => setForm((p) => ({ ...p, maxZones: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pkg-assets">{t.admin.maxAssetsLabel}</Label>
              <Input
                id="pkg-assets"
                inputMode="numeric"
                className="tabular-nums"
                value={form.maxAssets}
                onChange={(e) => setForm((p) => ({ ...p, maxAssets: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pkg-ops">{t.admin.maxOperatorsLabel}</Label>
              <Input
                id="pkg-ops"
                inputMode="numeric"
                className="tabular-nums"
                value={form.maxOperators}
                onChange={(e) => setForm((p) => ({ ...p, maxOperators: e.target.value }))}
              />
            </div>
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <PressableScale>
            <SaveButton type="button" className="h-12 w-full" onClick={save} disabled={!form.name.trim()} saved={saved} />
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet open={kebab !== null && !confirmDelete} onClose={() => setKebab(null)}>
        {kebab && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{kebab.name}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => openEdit(kebab)}>
              {t.admin.editPackage}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setConfirmDelete(true)}>
              {t.admin.deletePackage}
            </ActionSheetItem>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.admin.confirmDeletePackageTitle}</h2>
          <p className="text-body-airbnb">{t.admin.confirmDeletePackageBody}</p>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <PressableScale>
            <Button variant="destructive" className="h-12 w-full gap-1.5" onClick={deletePackage}>
              <Trash2 className="size-4" />
              {t.common.delete}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </AdminShell>
  );
}
