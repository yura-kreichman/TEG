"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Crown, MessageSquareMore, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { MoneyInput } from "@/components/money-input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { IconActionButton } from "@/components/kebab-menu";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { useI18n } from "@/components/i18n-provider";
import { InfoTooltip } from "@/components/info-tooltip";
import { Money } from "@/components/money";
import { PerformedByTag } from "@/components/performed-by-tag";
import { formatTime } from "@/lib/datetime-format";
import { parseMoneyInput } from "@/lib/format";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface ExpenseEntry {
  id: string;
  occurredAt: string;
  zoneId: string | null;
  zoneName: string;
  pointName: string;
  categoryId: string | null;
  categoryName: string | null;
  comment: string | null;
  amount: number;
  operatorName: string | null;
  operatorColorTag: string | null;
  editedByOwner: boolean;
}

interface ExpenseCategory {
  id: string;
  name: string;
}

interface ZoneOption {
  id: string;
  name: string;
  iconKey: string | null;
  pointName: string;
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

  // Правка/удаление ошибочно внесённого расхода (запрос пользователя
  // 2026-08-15) — тот же паттерн, что у инкассаций (money/zone-balances) и
  // авансов/премий. Сотруднику своя запись доступна только до сдачи итогов,
  // владельцу — всегда.
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [editing, setEditing] = useState<ExpenseEntry | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editZoneId, setEditZoneId] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { saved: editSaved, pulse: editPulse } = useSavePulse();

  function openEdit(expense: ExpenseEntry) {
    setEditing(expense);
    setEditAmount(String(expense.amount));
    setEditCategoryId(expense.categoryId ?? "");
    setEditZoneId(expense.zoneId ?? "");
    setEditComment(expense.comment ?? "");
    setEditError(null);
    setConfirmDelete(false);
  }

  async function submitEdit() {
    if (!editing || editSubmitting) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/money/expenses/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseMoneyInput(editAmount),
          categoryId: editCategoryId || null,
          zoneId: editZoneId || null,
          comment: editComment.trim() || null,
        }),
      });
      if (!res.ok) {
        setEditError((await res.json()).error ?? t.money.expenseSaveError);
        return;
      }
      await loadExpenses();
      editPulse(() => setEditing(null));
    } finally {
      setEditSubmitting(false);
    }
  }

  async function deleteExpense() {
    if (!editing) return;
    setEditError(null);
    const res = await fetch(`/api/money/expenses/${editing.id}`, { method: "DELETE" });
    if (!res.ok) {
      setEditError((await res.json()).error ?? t.money.expenseSaveError);
      return;
    }
    await loadExpenses();
    setEditing(null);
  }

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

  // Зоны тенанта — для смены зоны расхода (запрос владельца 2026-08-15:
  // сотрудник вполне мог записать трату не в ту кассу).
  async function loadZones() {
    const res = await fetch("/api/zones");
    if (res.ok) {
      const data = await res.json();
      setZones(data.zones ?? []);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  useEffect(() => {
    loadCategories();
    loadZones();
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

  if (checking) {
    return (
      <OwnerShell>
        <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
          <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-7 w-24 rounded-lg" />
            </div>
            <SpringCard hover={false} animate={false} className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </SpringCard>
          </div>
        </div>
      </OwnerShell>
    );
  }

  const calYear = calendarMonth.getUTCFullYear();
  const calMonth = calendarMonth.getUTCMonth() + 1;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <BackLink label={t.money.title} href="/money" />
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
                      {/* Первой строкой — категория (это главное, что владелец
                          ищет глазами), второй — время, зона, комментарий под
                          ⓘ-иконкой, кто внёс и корона правки. Запрос владельца
                          2026-08-16. */}
                      {group.items.map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
                        >
                          <span className="min-w-0 flex-1">
                            {/* Комментарий — под иконкой сразу за категорией
                                (уточнение владельца 2026-08-16): он относится
                                к самой трате, а не к строке времени/зоны. */}
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="truncate text-body-airbnb font-semibold">
                                {e.categoryName ?? t.money.editExpenseTitle}
                              </span>
                              {e.comment && (
                                <InfoTooltip
                                  icon={MessageSquareMore}
                                  text={e.comment}
                                  ariaLabel={t.operatorApp.submit.commentPlaceholder}
                                  className="size-4"
                                />
                              )}
                            </span>
                            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="truncate">
                                {formatTime(e.occurredAt)} · {e.zoneName}
                                {showPointName ? ` (${e.pointName})` : ""}
                              </span>
                              {/* Единый чип сотрудника по всему проекту —
                                  имя на тусклом фоне его цветовой метки
                                  (решение владельца 2026-08-16). */}
                              <PerformedByTag
                                name={e.operatorName}
                                isOwner={false}
                                avatarUrl={null}
                                iconKey={null}
                                colorTag={e.operatorColorTag}
                              />
                              {e.editedByOwner && <Crown className="size-3.5 shrink-0 text-success" />}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-bold tabular-nums"><Money value={e.amount} /></span>
                          <IconActionButton icon={Pencil} onClick={() => openEdit(e)} label={t.money.editExpenseAction} />
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

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <div className="flex flex-col gap-4 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.money.editExpenseTitle}</h2>
            <p className="-mt-2 text-caption-airbnb text-muted-foreground">
              {formatTime(editing.occurredAt)}
              {editing.operatorName ? ` · ${editing.operatorName}` : ""}
            </p>

            {/* Раскладка — как у правки инкассации и аванса/премии: подпись над
                контролом, сумма в одну строку с кнопкой сохранения, удаление
                за разделителем внизу. */}
            <div className="flex flex-col gap-1">
              <Label htmlFor="editExpenseAmount">{t.money.amountLabel}</Label>
              <MoneyInput
                id="editExpenseAmount"
                autoFocus
                scale="lg"
                className="h-14 text-lg"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>

            {zones.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label>{t.operatorApp.selectZone}</Label>
                {/* Иконки зон в списке касс (запрос владельца 2026-08-16) —
                    те же, что на плитках зон; в триггере показываем иконку
                    выбранной, тем же приёмом, что выбор точки на Главной. */}
                <Select
                  value={editZoneId || null}
                  onValueChange={(v) => setEditZoneId(v ?? "")}
                  items={zones.map((z) => ({
                    value: z.id,
                    label: showPointName ? `${z.name} · ${z.pointName}` : z.name,
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.operatorApp.selectZone}>
                      <span className="flex min-w-0 items-center gap-2">
                        {(() => {
                          const current = zones.find((z) => z.id === editZoneId);
                          if (!current) return null;
                          return (
                            <>
                              <AssetOrZoneIcon iconKey={current.iconKey} className="size-5 shrink-0" />
                              <span className="truncate">
                                {showPointName ? `${current.name} · ${current.pointName}` : current.name}
                              </span>
                            </>
                          );
                        })()}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          <AssetOrZoneIcon iconKey={z.iconKey} className="size-5 shrink-0" />
                          <span className="truncate">{showPointName ? `${z.name} · ${z.pointName}` : z.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {categories.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label>{t.money.expenseCategoriesTitle}</Label>
                <Select
                  value={editCategoryId || null}
                  onValueChange={(v) => setEditCategoryId(v ?? "")}
                  items={categories.map((c) => ({ value: c.id, label: c.name }))}
                >
                  <SelectTrigger className="h-11">
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
              </div>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="editExpenseComment">{t.operatorApp.submit.commentPlaceholder}</Label>
              <Input
                id="editExpenseComment"
                className="h-11"
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
              />
            </div>

            {editError && <p className="text-sm text-destructive">{editError}</p>}

            {/* Единый вид шторок правки (запрос владельца 2026-08-16):
                широкая "Сохранить", удаление одной иконкой рядом. Первый тап
                по мусорке показывает вопрос и заливает её красным, второй —
                удаляет. Отдельной широкой кнопки удаления нет. */}
            {confirmDelete && <p className="text-body-airbnb">{t.money.deleteExpenseConfirm}</p>}
            <div className="flex items-center gap-2">
              <PressableScale className="min-w-0 flex-1">
                <SaveButton
                  type="button"
                  className="h-12 w-full"
                  disabled={editSubmitting}
                  onClick={submitEdit}
                  saved={editSaved}
                />
              </PressableScale>
              <IconActionButton
                icon={Trash2}
                onClick={() => (confirmDelete ? deleteExpense() : setConfirmDelete(true))}
                label={t.common.delete}
                destructive
                active={confirmDelete}
              />
            </div>
          </div>
        )}
      </BottomSheet>

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
                      {/* Те же кнопки-иконки, что во всех остальных списках
                          (запрос владельца 2026-08-16): голые Pencil/Trash2
                          здесь остались с более ранней версии проекта. */}
                      <IconActionButton
                        icon={Pencil}
                        onClick={() => startRenameCategory(category)}
                        label={t.common.edit}
                      />
                      <IconActionButton
                        icon={Trash2}
                        onClick={() => deleteCategory(category.id)}
                        label={t.common.delete}
                        destructive
                      />
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
