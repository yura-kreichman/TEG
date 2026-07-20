"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaveButton } from "@/components/ui/save-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { Money } from "@/components/money";
import { formatTime } from "@/lib/datetime-format";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface ExpenseEntry {
  id: string;
  occurredAt: string;
  zoneName: string;
  pointName: string;
  categoryName: string | null;
  comment: string | null;
  amount: number;
}

interface ExpenseCategory {
  id: string;
  name: string;
}

export default function ExpensesRegisterPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [showPointName, setShowPointName] = useState(false);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const { saved: categorySaved, pulse: categoryPulse } = useSavePulse();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  async function loadExpenses() {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth() + 1;
    const res = await fetch(`/api/reports/money/expenses?year=${year}&month=${month}`);
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setExpenses(data.expenses ?? []);
    setShowPointName(!!data.showPointName);
    setChecking(false);
  }

  async function loadCategories() {
    const res = await fetch("/api/expense-categories");
    if (res.ok) {
      const data = await res.json();
      setCategories(data.categories ?? []);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  useEffect(() => {
    loadCategories();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function isCalendarCurrentMonth() {
    const today = new Date();
    return (
      calendarMonth.getUTCFullYear() === today.getUTCFullYear() && calendarMonth.getUTCMonth() === today.getUTCMonth()
    );
  }

  function stepCalendarMonth(delta: number) {
    if (delta > 0 && isCalendarCurrentMonth()) return;
    const next = new Date(calendarMonth);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setCalendarMonth(next);
  }

  function formatGroupDate(dateStr: string) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return `${d.getUTCDate()} ${t.readings.monthsGenitive[d.getUTCMonth()]}`;
  }

  function openCategories() {
    setEditingCategoryId(null);
    setNewCategoryName("");
    setCategoryError(null);
    setCategoriesOpen(true);
  }

  function startRenameCategory(category: ExpenseCategory) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setCategoryError(null);
  }

  async function confirmRenameCategory() {
    if (!editingCategoryId || !editingCategoryName.trim()) return;
    const res = await fetch(`/api/expense-categories/${editingCategoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingCategoryName.trim() }),
    });
    if (!res.ok) {
      setCategoryError((await res.json()).error ?? t.money.categorySaveError);
      return;
    }
    await loadCategories();
    categoryPulse(() => setEditingCategoryId(null));
    await loadExpenses();
  }

  async function deleteCategory(id: string) {
    await fetch(`/api/expense-categories/${id}`, { method: "DELETE" });
    await loadCategories();
    await loadExpenses();
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const res = await fetch("/api/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName.trim() }),
    });
    if (!res.ok) {
      setCategoryError((await res.json()).error ?? t.money.categorySaveError);
      return;
    }
    setNewCategoryName("");
    setCategoryError(null);
    await loadCategories();
  }

  const expenseGroups: { date: string; items: ExpenseEntry[] }[] = [];
  for (const e of expenses) {
    const dateKey = e.occurredAt.slice(0, 10);
    const lastGroup = expenseGroups[expenseGroups.length - 1];
    if (lastGroup && lastGroup.date === dateKey) lastGroup.items.push(e);
    else expenseGroups.push({ date: dateKey, items: [e] });
  }

  if (checking) return null;

  const calYear = calendarMonth.getUTCFullYear();
  const calMonth = calendarMonth.getUTCMonth() + 1;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <Link href="/money" className="w-fit text-body-airbnb font-semibold text-primary">
              ← {t.money.title}
            </Link>
            <PressableScale>
              <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={openCategories}>
                <Settings2 className="size-4" />
                {t.money.expenseCategoriesButton}
              </Button>
            </PressableScale>
          </div>
          <h1 className="text-screen-title">{t.money.expensesRegisterTitle}</h1>

          <SpringCard hover={false} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label={t.readings.prevMonth}
                onClick={() => stepCalendarMonth(-1)}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
              >
                <ChevronLeft className="size-4.5" />
              </button>
              <p className="text-card-title">
                {t.readings.months[calMonth - 1]} {calYear}
              </p>
              <button
                type="button"
                aria-label={t.readings.nextMonth}
                onClick={() => stepCalendarMonth(1)}
                disabled={isCalendarCurrentMonth()}
                className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4.5" />
              </button>
            </div>
            {expenseGroups.length === 0 ? (
              <p className="text-caption-airbnb text-muted-foreground">{t.money.noExpenses}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {expenseGroups.map((group) => (
                  <div key={group.date}>
                    <p className="mb-1 text-caption-airbnb font-semibold text-muted-foreground">
                      {formatGroupDate(group.date)}
                    </p>
                    <div className="flex flex-col">
                      {group.items.map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatTime(e.occurredAt)} · {e.zoneName}
                              {showPointName ? ` (${e.pointName})` : ""}
                              {e.categoryName ? ` · ${e.categoryName}` : ""}
                            </span>
                            {e.comment && (
                              <span className="block truncate text-[0.6875rem] text-muted-foreground/70">
                                {e.comment}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs font-bold tabular-nums"><Money value={e.amount} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SpringCard>
        </div>
      </div>

      <BottomSheet open={categoriesOpen} onClose={() => setCategoriesOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.money.expenseCategoriesTitle}</h2>
          {categories.length === 0 ? (
            <p className="text-caption-airbnb text-muted-foreground">{t.money.noExpenseCategories}</p>
          ) : (
            <div className="flex max-h-72 flex-col overflow-y-auto">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center gap-2 border-t border-border py-2 first:border-t-0"
                >
                  {editingCategoryId === category.id ? (
                    <>
                      <Input
                        autoFocus
                        value={editingCategoryName}
                        onChange={(e) => setEditingCategoryName(e.target.value)}
                        className="h-9 flex-1"
                      />
                      <PressableScale>
                        <SaveButton size="sm" onClick={confirmRenameCategory} saved={categorySaved} />
                      </PressableScale>
                      <button
                        type="button"
                        onClick={() => setEditingCategoryId(null)}
                        className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-body-airbnb">{category.name}</span>
                      <button
                        type="button"
                        onClick={() => startRenameCategory(category)}
                        className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCategory(category.id)}
                        className="flex size-8 shrink-0 items-center justify-center text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {categoryError && <p className="text-sm text-destructive">{categoryError}</p>}
          <div className="flex gap-2 border-t border-border pt-3">
            <Input
              placeholder={t.money.newCategoryPlaceholder}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="h-10 flex-1"
            />
            <PressableScale>
              <Button size="icon" onClick={addCategory} aria-label={t.common.add}>
                <Plus className="size-4" />
              </Button>
            </PressableScale>
          </div>
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
