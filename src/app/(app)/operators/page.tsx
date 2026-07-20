"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { StatusChip } from "@/components/status-chip";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { OpenShiftBadge } from "@/components/open-shift-badge";
import { useI18n } from "@/components/i18n-provider";
import { colorTagGradient } from "@/lib/utils";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface OperatorInfo {
  id: string;
  name: string;
  active: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag: string | null;
  allZonesAccess: boolean;
  allowedZones: { id: string; name: string }[];
  timeTrackingMode: "manual" | "auto";
  hasOpenShift: boolean;
}

export default function OperatorsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [operators, setOperators] = useState<OperatorInfo[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { saved: createSaved, pulse: createPulse } = useSavePulse();
  // Уволенных/деактивированных сотрудников не выкидываем из списка (нужны
  // истории/отчётам, docs/spec/05-work-time.md: "Деактивированный сохраняется
  // в истории и отчётах") — но и не мешаем ими рабочий список: сворачиваем
  // под отдельный заголовок, закрытый по умолчанию (запрос пользователя
  // 2026-07-14: "уволил, больше не нужен в списке"). Порядок вверх/вниз
  // теперь считается ТОЛЬКО внутри своей группы — см. фикс
  // /api/operators/[id]/move (иначе сосед по sortOrder мог оказаться скрытым
  // неактивным, и стрелка визуально ничего не делала бы).
  const [showInactive, setShowInactive] = useState(false);

  async function loadOperators() {
    const res = await fetch("/api/operators");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setOperators(data.operators ?? []);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Порядок операторов — ручной, задаёт владелец (фидбек 2026-07-11), влияет
  // на список/отчёты/сводки везде. Меняем местами с соседом на сервере и
  // перезагружаем список, а не переставляем локально — sortOrder может
  // разойтись при параллельной правке в другой вкладке.
  async function moveOperator(id: string, direction: "up" | "down") {
    await fetch(`/api/operators/${id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    await loadOperators();
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{4,6}$/.test(pin)) {
      setError(t.operators.pinFormatError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось создать оператора");
        return;
      }

      await loadOperators();
      createPulse(() => {
        setName("");
        setPin("");
        setCreateOpen(false);
      });
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  const activeOperators = operators.filter((o) => o.active);
  const inactiveOperators = operators.filter((o) => !o.active);

  function renderOperatorCard(operator: OperatorInfo, disableUp: boolean, disableDown: boolean, showMove: boolean) {
    return (
      <StaggerItem key={operator.id}>
        <PressableScale>
          <SpringCard
            animate={false}
            className="cursor-pointer"
            onClick={() => router.push(`/operators/${operator.id}`)}
            style={{ background: colorTagGradient(operator.colorTag) }}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  {operator.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={operator.avatarUrl} alt="" className="size-12.5 rounded-full object-cover" />
                  ) : operator.iconKey ? (
                    <div className="flex size-12.5 items-center justify-center rounded-full bg-primary/10">
                      <AssetOrZoneIcon iconKey={operator.iconKey} className="size-10" />
                    </div>
                  ) : (
                    <div className="flex size-12.5 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                      {operator.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  {operator.colorTag && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-card"
                      style={{ backgroundColor: operator.colorTag }}
                    />
                  )}
                </div>
                <div className="flex min-w-0 grow flex-wrap items-center gap-1.5">
                  <span className="text-card-title">{operator.name}</span>
                  <StatusChip variant={operator.active ? "accent" : "warning"}>
                    {operator.active ? t.operators.active : t.operators.inactive}
                  </StatusChip>
                </div>
                {showMove && (
                  <div className="flex shrink-0 flex-col" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={disableUp}
                      onClick={() => moveOperator(operator.id, "up")}
                      aria-label={t.common.moveUp}
                      className="flex size-6 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={disableDown}
                      onClick={() => moveOperator(operator.id, "down")}
                      aria-label={t.common.moveDown}
                      className="flex size-6 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </div>
                )}
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </div>
              <div className="relative flex flex-wrap items-center gap-1.5 pr-6">
                {operator.allZonesAccess ? (
                  <StatusChip variant="accent">{t.operators.allZonesChip}</StatusChip>
                ) : operator.allowedZones.length > 0 ? (
                  <StatusChip variant="accent">
                    {operator.allowedZones.map((z) => z.name).join(", ")}
                  </StatusChip>
                ) : (
                  <StatusChip variant="warning">{t.operators.noZoneAccessChip}</StatusChip>
                )}
                {operator.hasOpenShift && operator.timeTrackingMode === "auto" && (
                  <OpenShiftBadge className="top-1/2 right-0 bottom-auto -translate-y-1/2" />
                )}
              </div>
            </div>
          </SpringCard>
        </PressableScale>
      </StaggerItem>
    );
  }

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.operators.title}</h1>
            <PressableScale>
              <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t.common.add}
              </Button>
            </PressableScale>
          </div>

          {operators.length === 0 ? (
            <p className="mt-4 text-body-airbnb text-muted-foreground">{t.operators.noOperators}</p>
          ) : (
            <>
              <StaggerList className="mt-4 flex flex-col gap-3.5">
                {activeOperators.map((operator, index) =>
                  renderOperatorCard(operator, index === 0, index === activeOperators.length - 1, true)
                )}
              </StaggerList>

              {inactiveOperators.length > 0 && (
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setShowInactive((prev) => !prev)}
                    className="flex w-full items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
                  >
                    {showInactive ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    {t.operators.inactiveSectionLabel} ({inactiveOperators.length})
                  </button>
                  {showInactive && (
                    <StaggerList className="mt-3 flex flex-col gap-3.5">
                      {inactiveOperators.map((operator) => renderOperatorCard(operator, true, true, false))}
                    </StaggerList>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operators.newOperatorTitle}</h2>
            <p className="text-caption-airbnb">{t.operators.newOperatorSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">{t.operators.nameLabel}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pin">{t.operators.pinLabel}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="pin"
                inputMode="numeric"
                pattern="\d{4,6}"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
                className="h-12 flex-1"
              />
              <PressableScale>
                <SaveButton type="submit" disabled={loading} className="h-12" saved={createSaved} />
              </PressableScale>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </BottomSheet>
    </OwnerShell>
  );
}
