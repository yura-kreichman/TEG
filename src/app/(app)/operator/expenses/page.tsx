"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, MapPin, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { parseMoneyInput } from "@/lib/format";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { BackLink } from "@/components/back-link";
import { IconActionButton } from "@/components/kebab-menu";
import { SpringCard } from "@/components/spring-card";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { Money } from "@/components/money";
import { ActionToast } from "@/components/action-toast";
import { useI18n } from "@/components/i18n-provider";
import { formatTime } from "@/lib/datetime-format";
import { cn } from "@/lib/utils";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useActionToast } from "@/hooks/use-action-toast";
import { playErrorChime } from "@/lib/beep";

interface ExpenseZone {
  id: string;
  name: string;
  iconKey: string | null;
}

interface ExpenseCategory {
  id: string;
  name: string;
}

interface ExpenseEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  amount: number;
  categoryName: string | null;
  comment: string | null;
  createdAt: string;
}

/**
 * Пункт "Расходы" на Главной оператора (запрос пользователя 2026-07-25:
 * "чтобы не надо было запоминать до конца смены") — тот же принцип, что
 * "Счётчики"/Возвраты: мгновенная запись + read-only история + автосброс
 * после сдачи итогов (см. previousSubmissionBoundary в API-роуте). В отличие
 * от "Счётчиков" доступна для ЛЮБОЙ зоны точки, не только режима "Счётчики" —
 * расход не завязан на способ учёта. Гейтится Tenant.expensesEnabled — если
 * Владелец выключил тумблер в Настройках → Система, экран целиком
 * недоступен (сервер вернёт 403, редирект на Главную).
 */
export default function OperatorExpensesPage() {
  const router = useRouter();
  const t = useI18n();
  const [zones, setZones] = useState<ExpenseZone[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [events, setEvents] = useState<ExpenseEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [formZoneId, setFormZoneId] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formComment, setFormComment] = useState("");
  const [saving, setSaving] = useState(false);
  const { saved: formSaved, pulse: formPulse } = useSavePulse();
  const errorToast = useActionToast();
  function flashError(message: string) {
    playErrorChime();
    errorToast.flash(message, "error");
  }

  function loadEvents() {
    fetch("/api/operator/zone-expense-events")
      .then((res) => {
        if (res.status === 403) {
          router.replace("/operator");
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (!data) return;
        setZones(data.zones ?? []);
        setCategories(data.categories ?? []);
        setEvents(data.events ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSheet() {
    setFormZoneId(zones.length === 1 ? zones[0].id : "");
    setFormAmount("");
    setFormCategoryId("");
    setFormComment("");
    setSheetOpen(true);
  }

  async function submitExpense() {
    if (saving) return;
    if (!formZoneId) {
      flashError(t.operatorApp.selectZone);
      return;
    }
    const amount = parseMoneyInput(formAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      flashError(t.operatorApp.submit.amountPlaceholder);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/operator/zone-expense-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneId: formZoneId,
          amount,
          categoryId: formCategoryId || null,
          comment: formComment.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data.error ?? t.operatorApp.workTime.saveError);
        return;
      }
      const zone = zones.find((z) => z.id === formZoneId);
      const category = categories.find((c) => c.id === formCategoryId);
      setEvents((prev) => [
        {
          id: data.id,
          zoneId: formZoneId,
          zoneName: zone?.name ?? "",
          amount: data.amount,
          categoryName: category?.name ?? null,
          comment: formComment.trim() || null,
          createdAt: data.createdAt,
        },
        ...prev,
      ]);
      formPulse(() => setSheetOpen(false));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/operator/zone-expense-events/${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 md:max-w-xl lg:max-w-2xl">
          <Skeleton className="mb-2 h-7 w-32" />
          <Skeleton className="h-14 rounded-control" />
          <SkeletonListRows count={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <BackLink label={t.common.back} href="/operator" />
        <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.operatorApp.submit.expensesTitle}</h1>

        <PressableScale>
          <Button
            type="button"
            disabled={zones.length === 0}
            onClick={openSheet}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-control text-base font-bold"
          >
            <Plus className="size-5" />
            {t.operatorApp.submit.addExpense}
          </Button>
        </PressableScale>

        <div className="flex flex-col gap-2">
          <p className="text-caption-airbnb font-semibold text-muted-foreground">{t.operatorApp.counters.logTitle}</p>
          {events.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.operatorApp.submit.expensesEmpty}</p>
          ) : (
            <StaggerList className="flex flex-col gap-2.5">
              {events.map((e) => (
                <StaggerItem key={e.id}>
                  <SpringCard animate={false} className="!p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                        <ShoppingCart className="size-4" />
                      </div>
                      <div className="min-w-0 grow">
                        <div className="truncate text-body-airbnb font-semibold">
                          {e.categoryName ?? t.operatorApp.submit.expensesTitle}
                        </div>
                        <p className="truncate text-caption-airbnb text-muted-foreground">
                          {formatTime(e.createdAt)}
                          {zones.length > 1 ? ` · ${e.zoneName}` : ""}
                          {e.comment ? ` · ${e.comment}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums font-bold">
                        <Money value={e.amount} />
                      </span>
                      <IconActionButton icon={Trash2} onClick={() => deleteEvent(e.id)} label={t.common.delete} destructive />
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => !saving && setSheetOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.submit.addExpense}</h2>

          {zones.length > 1 && (
            <div className="grid grid-cols-3 gap-3">
              {zones.map((zone) => {
                const selected = formZoneId === zone.id;
                return (
                  <PressableScale key={zone.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setFormZoneId(zone.id)}
                      className={cn(
                        "relative flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] px-3 py-5 text-center shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)]",
                        selected ? "border-primary bg-primary/10" : "border-border bg-card"
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-14 items-center justify-center rounded-control",
                          selected ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/50"
                        )}
                      >
                        {zone.iconKey ? (
                          <AssetOrZoneIcon iconKey={zone.iconKey} className="size-9" />
                        ) : (
                          <MapPin className="size-9" />
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-[0.90625rem] font-semibold",
                          selected ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {zone.name}
                      </span>
                    </button>
                    {selected && (
                      <span className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                        <Check className="size-5" />
                      </span>
                    )}
                  </PressableScale>
                );
              })}
            </div>
          )}

          <MoneyInput
            autoFocus
            scale="lg"
            placeholder={t.operatorApp.submit.amountPlaceholder}
            className="h-14 rounded-control bg-muted text-lg font-bold"
            value={formAmount}
            onChange={(e) => setFormAmount(e.target.value)}
          />

          {categories.length > 0 && (
            <Select
              value={formCategoryId || null}
              onValueChange={(v) => setFormCategoryId(v ?? "")}
              items={categories.map((c) => ({ value: c.id, label: c.name }))}
            >
              <SelectTrigger className="h-10 bg-muted text-sm">
                <SelectValue placeholder={t.operatorApp.submit.categoryPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Input
            placeholder={t.operatorApp.submit.commentPlaceholder}
            className="rounded-control bg-muted"
            value={formComment}
            onChange={(e) => setFormComment(e.target.value)}
          />

          <PressableScale className="w-full">
            <SaveButton
              type="button"
              className="h-14 w-full text-lg font-bold"
              disabled={saving}
              saved={formSaved}
              onClick={submitExpense}
            />
          </PressableScale>
        </div>
      </BottomSheet>
      <ActionToast message={errorToast.message} variant={errorToast.variant} />
    </div>
  );
}
