"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton } from "@/components/kebab-menu";
import { StatusChip } from "@/components/status-chip";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { colorTagGradient } from "@/lib/utils";

interface OperatorInfo {
  id: string;
  name: string;
  active: boolean;
  avatarUrl: string | null;
  iconKey: string | null;
  colorTag: string | null;
  allZonesAccess: boolean;
  allowedZones: { id: string; name: string }[];
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

      setName("");
      setPin("");
      setCreateOpen(false);
      await loadOperators();
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.operators.title}</h1>
            <PressableScale>
              <Button variant="dark" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t.common.add}
              </Button>
            </PressableScale>
          </div>

          {operators.length === 0 ? (
            <p className="mt-4 text-body-airbnb text-muted-foreground">{t.operators.noOperators}</p>
          ) : (
            <StaggerList className="mt-4 flex flex-col gap-3.5">
              {operators.map((operator, index) => (
                <StaggerItem key={operator.id}>
                  <PressableScale>
                    <SpringCard
                      animate={false}
                      className="cursor-pointer"
                      onClick={() => router.push(`/operators/${operator.id}`)}
                      style={{ background: colorTagGradient(operator.colorTag) }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                          {operator.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={operator.avatarUrl} alt="" className="size-12.5 rounded-full object-cover" />
                          ) : operator.iconKey ? (
                            <div className="flex size-12.5 items-center justify-center rounded-full bg-primary/10">
                              <AssetOrZoneIcon iconKey={operator.iconKey} className="size-7" />
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
                        <div className="min-w-0 grow">
                          <div className="text-card-title">{operator.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusChip variant={operator.active ? "accent" : "warning"}>
                              {operator.active ? t.operators.active : t.operators.inactive}
                            </StatusChip>
                            {operator.allZonesAccess ? (
                              <StatusChip variant="accent">{t.operators.allZonesChip}</StatusChip>
                            ) : operator.allowedZones.length > 0 ? (
                              <StatusChip variant="accent">
                                {operator.allowedZones.map((z) => z.name).join(", ")}
                              </StatusChip>
                            ) : (
                              <StatusChip variant="warning">{t.operators.noZoneAccessChip}</StatusChip>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveOperator(operator.id, "up")}
                            aria-label={t.common.moveUp}
                            className="flex size-6 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                          >
                            <ChevronUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === operators.length - 1}
                            onClick={() => moveOperator(operator.id, "down")}
                            aria-label={t.common.moveDown}
                            className="flex size-6 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>
                          <KebabButton
                            onClick={() => router.push(`/operators/${operator.id}/settings`)}
                            label={t.operators.actionsLabel}
                          />
                        </div>
                      </div>
                    </SpringCard>
                  </PressableScale>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.operators.newOperatorTitle}</h2>
            <p className="text-caption-airbnb">{t.operators.newOperatorSub}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">{t.operators.nameLabel}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pin">{t.operators.pinLabel}</Label>
            <Input
              id="pin"
              inputMode="numeric"
              pattern="\d{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <Button type="submit" disabled={loading} className="w-full">
              {t.operators.addButton}
            </Button>
          </PressableScale>
        </form>
      </BottomSheet>
    </OwnerShell>
  );
}
