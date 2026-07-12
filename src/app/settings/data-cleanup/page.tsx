"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, ClipboardList, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";

type CleanupCategory = "results" | "collections" | "shifts" | "change_fund" | "all";

export default function DataCleanupPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [tenantName, setTenantName] = useState("");

  const [target, setTarget] = useState<CleanupCategory | null>(null);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/data-cleanup")
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        setTenantName(data.tenantName ?? "");
        setChecking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories: Array<{ key: CleanupCategory; icon: typeof ClipboardList; title: string; hint: string }> = [
    { key: "results", icon: ClipboardList, title: t.dataCleanup.resultsTitle, hint: t.dataCleanup.resultsHint },
    { key: "collections", icon: Banknote, title: t.dataCleanup.collectionsTitle, hint: t.dataCleanup.collectionsHint },
    { key: "shifts", icon: RefreshCw, title: t.dataCleanup.shiftsTitle, hint: t.dataCleanup.shiftsHint },
    { key: "change_fund", icon: Banknote, title: t.dataCleanup.changeFundTitle, hint: t.dataCleanup.changeFundHint },
  ];

  function openConfirm(category: CleanupCategory) {
    setTarget(category);
    setPassword("");
    setConfirmText("");
    setError(null);
    setDone(false);
  }

  async function handleConfirm() {
    if (!target) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/data-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: target, password, confirmText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.dataCleanup.genericError);
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = password.trim().length > 0 && confirmText.trim() === tenantName;
  const targetTitle =
    target === "all"
      ? t.dataCleanup.fullWipeTitle
      : (categories.find((c) => c.key === target)?.title ?? "");

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="text-screen-title">{t.dataCleanup.title}</h1>
          <p className="mb-4 text-caption-airbnb">{t.dataCleanup.hint}</p>

          <StaggerList className="flex flex-col gap-3">
            {categories.map((cat) => (
              <StaggerItem key={cat.key}>
                <SpringCard animate={false} hover={false} className="flex items-center gap-3.5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                    <cat.icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-airbnb font-bold">{cat.title}</div>
                    <div className="text-caption-airbnb">{cat.hint}</div>
                  </div>
                  <PressableScale>
                    <Button variant="destructive" size="sm" onClick={() => openConfirm(cat.key)}>
                      {t.dataCleanup.clearAction}
                    </Button>
                  </PressableScale>
                </SpringCard>
              </StaggerItem>
            ))}

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-3 border-destructive/40">
                <div className="flex items-center gap-3.5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                    <AlertTriangle className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-airbnb font-bold text-destructive">{t.dataCleanup.fullWipeTitle}</div>
                    <div className="text-caption-airbnb">{t.dataCleanup.fullWipeHint}</div>
                  </div>
                </div>
                <PressableScale>
                  <Button variant="destructive" className="w-full gap-2" onClick={() => openConfirm("all")}>
                    <Trash2 className="size-4" />
                    {t.dataCleanup.fullWipeAction}
                  </Button>
                </PressableScale>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>

      <BottomSheet open={target !== null} onClose={() => setTarget(null)}>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.dataCleanup.confirmSheetTitle}</h2>
            <p className="mt-1 text-caption-airbnb">{targetTitle}</p>
          </div>

          {done ? (
            <>
              <p className="text-body-airbnb text-success">{t.dataCleanup.doneMessage}</p>
              <PressableScale>
                <Button className="w-full" onClick={() => setTarget(null)}>
                  {t.common.close}
                </Button>
              </PressableScale>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cleanupPassword">{t.dataCleanup.confirmPasswordLabel}</Label>
                <Input
                  id="cleanupPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cleanupConfirmText">
                  {t.dataCleanup.confirmNamePrefix} <span className="text-foreground">{tenantName}</span>
                </Label>
                <Input
                  id="cleanupConfirmText"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
                <span className="text-caption-airbnb">{t.dataCleanup.confirmNameHint}</span>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <PressableScale>
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  disabled={!canSubmit || loading}
                  onClick={handleConfirm}
                >
                  <Trash2 className="size-4" />
                  {t.dataCleanup.confirmButton}
                </Button>
              </PressableScale>
            </>
          )}
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
