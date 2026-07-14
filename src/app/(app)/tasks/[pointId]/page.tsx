"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ClipboardList, Wrench, CheckCircle2, MapPin, X } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ActionSheetItem } from "@/components/kebab-menu";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type TaskStatus } from "@/lib/tasks";

interface TaskOperator {
  id: string;
  name: string;
  colorTag: string | null;
  avatarUrl: string | null;
  iconKey: string | null;
}

interface TaskUser {
  id: string;
  email: string;
}

interface TaskInfo {
  id: string;
  title: string;
  note: string | null;
  status: TaskStatus;
  createdAt: string;
  assignedOperators: TaskOperator[];
  assignedUsers: TaskUser[];
}

interface OperatorOption {
  id: string;
  name: string;
  colorTag: string | null;
  avatarUrl: string | null;
  iconKey: string | null;
  active: boolean;
}

// Фото > SVG-аватар > буква имени — тот же приоритет, что и везде у
// оператора (профиль/список/шапка PWA), просто в размере чипа (фидбек
// 2026-07-12: тут была всегда только буква, хотя у оператора уже может
// быть настоящий аватар).
function Avatar({
  label,
  colorTag,
  avatarUrl,
  iconKey,
}: {
  label: string;
  colorTag: string | null;
  avatarUrl?: string | null;
  iconKey?: string | null;
}) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt="" className="size-6.5 shrink-0 rounded-full object-cover" />;
  }
  if (iconKey) {
    return (
      <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <AssetOrZoneIcon iconKey={iconKey} className="size-5" />
      </span>
    );
  }
  return (
    <span
      className="flex size-6.5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: colorTag ?? "var(--color-primary)" }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function TasksKanbanPage({ params }: { params: Promise<{ pointId: string }> }) {
  const { pointId } = use(params);
  const router = useRouter();
  const t = useI18n();

  const [checking, setChecking] = useState(true);
  const [pointName, setPointName] = useState("");
  const [points, setPoints] = useState<{ id: string; name: string; iconKey: string | null }[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [curSeg, setCurSeg] = useState<TaskStatus>("todo");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TaskInfo | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<Set<string>>(new Set());
  const [assignMe, setAssignMe] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [actionsFor, setActionsFor] = useState<TaskInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function loadAll() {
    const [tasksRes, opsRes, meRes] = await Promise.all([
      fetch(`/api/points/${pointId}/tasks`),
      fetch("/api/operators"),
      fetch("/api/auth/me"),
    ]);
    if (tasksRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (tasksRes.status === 404) {
      router.replace("/tasks");
      return;
    }
    const tasksData = await tasksRes.json();
    const opsData = await opsRes.json();
    const meData = await meRes.json();
    setTasks(tasksData.tasks ?? []);
    setPointName(tasksData.pointName ?? "");
    setOperators((opsData.operators ?? []).filter((o: OperatorOption) => o.active));
    setMeId(meData.user?.id ?? null);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId]);

  // Список точек для дропдауна выбора — без отдельного экрана-пикера
  // (фидбек пользователя 2026-07-13). Загружается один раз, не зависит от pointId.
  useEffect(() => {
    fetch("/api/points")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data)
          setPoints(
            (data.points ?? []).map((p: { id: string; name: string; iconKey: string | null }) => ({
              id: p.id,
              name: p.name,
              iconKey: p.iconKey,
            })),
          );
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openCreate() {
    setEditing(null);
    setTitle("");
    setNote("");
    setSelectedOperatorIds(new Set());
    setAssignMe(false);
    setSaveError(null);
    setEditorOpen(true);
  }

  function openEdit(task: TaskInfo) {
    setActionsFor(null);
    setEditing(task);
    setTitle(task.title);
    setNote(task.note ?? "");
    setSelectedOperatorIds(new Set(task.assignedOperators.map((o) => o.id)));
    setAssignMe(meId !== null && task.assignedUsers.some((u) => u.id === meId));
    setSaveError(null);
    setEditorOpen(true);
  }

  function toggleOperator(id: string) {
    setSelectedOperatorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveTask() {
    if (!title.trim()) return;
    setSaveError(null);
    const payload = {
      title: title.trim(),
      note: note.trim() || null,
      assignedOperatorIds: [...selectedOperatorIds],
      assignedUserIds: assignMe && meId ? [meId] : [],
    };
    const res = await fetch(
      editing ? `/api/tasks/${editing.id}` : `/api/points/${pointId}/tasks`,
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const data = await res.json();
      setSaveError(data.error ?? t.tasks.genericError);
      return;
    }
    setEditorOpen(false);
    await loadAll();
  }

  async function moveTask(status: TaskStatus) {
    if (!actionsFor) return;
    await fetch(`/api/tasks/${actionsFor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setActionsFor(null);
    setCurSeg(status);
    await loadAll();
  }

  async function deleteTask() {
    if (!actionsFor) return;
    await fetch(`/api/tasks/${actionsFor.id}`, { method: "DELETE" });
    setActionsFor(null);
    setConfirmDelete(false);
    await loadAll();
  }

  if (checking) return null;

  const SEG_ICON: Record<TaskStatus, typeof ClipboardList> = {
    todo: ClipboardList,
    doing: Wrench,
    done: CheckCircle2,
  };
  const SEG_LABEL: Record<TaskStatus, string> = {
    todo: t.tasks.statusTodo,
    doing: t.tasks.statusDoing,
    done: t.tasks.statusDone,
  };
  const visibleTasks = tasks.filter((task) => task.status === curSeg);

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.tasks.pickPointTitle}</h1>
            <PressableScale>
              <Button variant="dark" size="sm" className="gap-1.5" onClick={openCreate}>
                <Plus className="size-4" />
                {t.tasks.addButton}
              </Button>
            </PressableScale>
          </div>
          {points.length > 1 ? (
            <div className="mb-4">
              <Select value={pointId} onValueChange={(v) => v && router.push(`/tasks/${v}`)} items={points.map((p) => ({ value: p.id, label: p.name }))}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {(() => {
                        const current = points.find((p) => p.id === pointId);
                        return current?.iconKey ? (
                          <AssetOrZoneIcon iconKey={current.iconKey} className="size-6 shrink-0" />
                        ) : (
                          <MapPin className="size-6 shrink-0 text-muted-foreground" />
                        );
                      })()}
                      {pointName}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {points.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.iconKey ? (
                          <AssetOrZoneIcon iconKey={p.iconKey} className="size-6 shrink-0" />
                        ) : (
                          <MapPin className="size-6 shrink-0 text-muted-foreground" />
                        )}
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="mb-4 text-caption-airbnb">{pointName}</p>
          )}

          <div className="mb-4 flex gap-1.5">
            {TASK_STATUSES.map((status) => {
              const count = tasks.filter((task) => task.status === status).length;
              const active = curSeg === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setCurSeg(status)}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-0.5 rounded-control border py-2 text-xs font-semibold",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  <span className="text-[15px] font-extrabold">{count}</span>
                  {SEG_LABEL[status]}
                </button>
              );
            })}
          </div>

          {visibleTasks.length === 0 ? (
            <p className="rounded-block border-[1.5px] border-dashed border-border py-8 text-center text-body-airbnb text-muted-foreground">
              {t.tasks.emptyColumn}
            </p>
          ) : (
            <StaggerList className="flex flex-col gap-3">
              {visibleTasks.map((task) => (
                <StaggerItem key={task.id}>
                  <SpringCard animate={false}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 grow">
                        <div
                          className={cn(
                            "text-card-title",
                            task.status === "done" && "text-muted-foreground line-through"
                          )}
                        >
                          {task.title}
                        </div>
                        {task.note && <p className="mt-1 text-caption-airbnb">{task.note}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActionsFor(task)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                        aria-label={t.tasks.actionsTitle}
                      >
                        ···
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {task.assignedOperators.length === 0 && task.assignedUsers.length === 0 ? (
                          <span className="text-caption-airbnb">{t.tasks.allOperatorsChip}</span>
                        ) : (
                          <>
                            {task.assignedOperators.map((op) => (
                              <Avatar key={op.id} label={op.name} colorTag={op.colorTag} avatarUrl={op.avatarUrl} iconKey={op.iconKey} />
                            ))}
                            {task.assignedUsers.map((u) => (
                              <Avatar key={u.id} label={t.tasks.meLabel} colorTag={null} />
                            ))}
                          </>
                        )}
                      </div>
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
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">
              {editing ? t.tasks.editTaskTitle : t.tasks.newTaskTitle}
            </h2>
            <p className="text-caption-airbnb">{t.tasks.newTaskSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-title">{t.tasks.titleFieldLabel}</Label>
            <Input
              id="task-title"
              autoFocus
              placeholder={t.tasks.titleFieldPlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-note">
              {t.tasks.noteFieldLabel} <span className="font-normal text-muted-foreground">· {t.common.optional}</span>
            </Label>
            <Textarea
              id="task-note"
              rows={2}
              placeholder={t.tasks.noteFieldPlaceholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              {t.tasks.assigneesFieldLabel}{" "}
              <span className="font-normal text-muted-foreground">· {t.tasks.assigneesFieldHint}</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAssignMe((prev) => !prev)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border-[1.5px] py-1.5 pl-1.5 pr-3 text-sm font-semibold",
                  assignMe ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                )}
              >
                <Avatar label={t.tasks.meLabel} colorTag={assignMe ? null : "#9AA39F"} />
                {t.tasks.meLabel}
              </button>
              {operators.map((op) => {
                const selected = selectedOperatorIds.has(op.id);
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => toggleOperator(op.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border-[1.5px] py-1.5 pl-1.5 pr-3 text-sm font-semibold",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground"
                    )}
                  >
                    <Avatar
                      label={op.name}
                      colorTag={selected ? op.colorTag : "#9AA39F"}
                      avatarUrl={op.avatarUrl}
                      iconKey={op.iconKey}
                    />
                    {op.name}
                  </button>
                );
              })}
            </div>
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <PressableScale>
            <SaveButton type="button" className="w-full" onClick={saveTask} disabled={!title.trim()}>
              {t.common.save}
            </SaveButton>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet
        open={actionsFor !== null && !confirmDelete}
        onClose={() => setActionsFor(null)}
      >
        {actionsFor && (
          <div className="pt-2">
            <h2 className="mb-2 text-[19px] font-extrabold tracking-[-0.01em]">{actionsFor.title}</h2>
            <ActionSheetItem icon={Pencil} onClick={() => openEdit(actionsFor)}>
              {t.tasks.editAction}
            </ActionSheetItem>
            {TASK_STATUSES.map((status) => {
              const Icon = SEG_ICON[status];
              const label =
                status === "todo" ? t.tasks.moveToTodo : status === "doing" ? t.tasks.moveToDoing : t.tasks.moveToDone;
              return (
                <ActionSheetItem
                  key={status}
                  icon={Icon}
                  disabled={actionsFor.status === status}
                  onClick={() => moveTask(status)}
                >
                  {label}
                </ActionSheetItem>
              );
            })}
            <ActionSheetItem icon={Trash2} destructive onClick={() => setConfirmDelete(true)}>
              {t.tasks.deleteAction}
            </ActionSheetItem>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.tasks.confirmDeleteTitle}</h2>
          <p className="text-body-airbnb">{t.tasks.confirmDeleteBody}</p>
          <div className="flex gap-2">
            <PressableScale className="flex-1">
              <Button variant="outline" className="w-full gap-1.5" onClick={() => setConfirmDelete(false)}>
                <X className="size-4" />
                {t.common.cancel}
              </Button>
            </PressableScale>
            <PressableScale className="flex-1">
              <Button variant="destructive" className="w-full gap-1.5" onClick={deleteTask}>
                <Trash2 className="size-4" />
                {t.common.delete}
              </Button>
            </PressableScale>
          </div>
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
