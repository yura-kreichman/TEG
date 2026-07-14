"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, FileText, Link2, Plus, Send, Trash2 } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { InstructionQrSheet } from "@/components/instructions/instruction-qr-sheet";
import { AcknowledgmentRecordSheet } from "@/components/instructions/acknowledgment-record-sheet";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { AcknowledgmentRecordItem, InstructionListItem } from "@/lib/instructions/client-types";

type Tab = "instructions" | "log";
type KebabView = "menu" | "confirm-archive" | "confirm-delete";

const STATUS_STYLES: Record<InstructionListItem["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-primary/10 text-primary",
  archived: "bg-warning/15 text-warning",
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function InstructionsSettingsPage() {
  const t = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("instructions");

  const [instructions, setInstructions] = useState<InstructionListItem[]>([]);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [loadingInstructions, setLoadingInstructions] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const [kebabTarget, setKebabTarget] = useState<InstructionListItem | null>(null);
  const [kebabView, setKebabView] = useState<KebabView>("menu");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [qrTarget, setQrTarget] = useState<InstructionListItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [records, setRecords] = useState<AcknowledgmentRecordItem[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [filterInstructionId, setFilterInstructionId] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<AcknowledgmentRecordItem | null>(null);

  async function loadInstructions() {
    setLoadingInstructions(true);
    const res = await fetch("/api/instructions");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setInstructions(data.instructions ?? []);
    setTenantSlug(data.tenantSlug ?? null);
    setLoadingInstructions(false);
  }

  async function loadRecords() {
    setLoadingRecords(true);
    const params = new URLSearchParams();
    if (filterInstructionId !== "all") params.set("instructionId", filterInstructionId);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    const res = await fetch(`/api/instructions/records?${params.toString()}`);
    const data = await res.json();
    setRecords(data.records ?? []);
    setLoadingRecords(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadInstructions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "log") loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterInstructionId, filterFrom, filterTo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function createInstruction() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateOpen(false);
        setNewTitle("");
        router.push(`/settings/instructions/${data.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  async function archiveInstruction() {
    if (!kebabTarget) return;
    await fetch(`/api/instructions/${kebabTarget.id}/archive`, { method: "POST" });
    setKebabTarget(null);
    setKebabView("menu");
    loadInstructions();
  }

  async function deleteInstruction() {
    if (!kebabTarget) return;
    setDeleteError(null);
    const res = await fetch(`/api/instructions/${kebabTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      setKebabTarget(null);
      setKebabView("menu");
      loadInstructions();
      return;
    }
    const data = await res.json().catch(() => null);
    setDeleteError(data?.error ?? t.instructions.deleteBlockedHint);
  }

  function publicUrl(item: InstructionListItem): string {
    if (!tenantSlug || typeof window === "undefined") return "";
    return `${window.location.origin}/i/${tenantSlug}/${item.slug}`;
  }

  function copyLink(item: InstructionListItem) {
    const url = publicUrl(item);
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1500);
  }

  const statusLabel: Record<InstructionListItem["status"], string> = {
    draft: t.instructions.statusDraft,
    published: t.instructions.statusPublished,
    archived: t.instructions.statusArchived,
  };

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <h1 className="text-screen-title">{t.instructions.settingsTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.instructions.settingsHint}</p>

          <SegmentedTabs
            className="mb-4"
            options={[
              { key: "instructions", label: t.instructions.tabInstructions },
              { key: "log", label: t.instructions.tabLog },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "instructions" && (
            <>
              <PressableScale className="mb-3 w-fit self-end">
                <Button type="button" variant="dark" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  {t.instructions.addButton}
                </Button>
              </PressableScale>

              {!loadingInstructions && instructions.length === 0 && (
                <SpringCard hover={false}>
                  <p className="text-body-airbnb text-muted-foreground">{t.instructions.emptyState}</p>
                </SpringCard>
              )}

              <StaggerList className="flex flex-col gap-3">
                {instructions.map((item) => (
                  <StaggerItem key={item.id}>
                    <SpringCard animate={false} className="flex items-center gap-3.5">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <FileText className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body-airbnb font-bold">{item.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption-airbnb">
                          <span className={cn("rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", STATUS_STYLES[item.status])}>
                            {statusLabel[item.status]}
                          </span>
                          {item.currentVersionNumber > 0 && <span>v{item.currentVersionNumber}</span>}
                          <span>· {t.instructions.recordsCountLabel.replace("{count}", String(item.recordsCount))}</span>
                        </div>
                      </div>
                      <KebabButton label={t.instructions.editAction} onClick={() => setKebabTarget(item)} />
                    </SpringCard>
                  </StaggerItem>
                ))}
              </StaggerList>
            </>
          )}

          {tab === "log" && (
            <>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <Select
                  value={filterInstructionId}
                  onValueChange={(v) => v && setFilterInstructionId(v)}
                  items={[
                    { value: "all", label: t.instructions.filterAllInstructions },
                    ...instructions.map((i) => ({ value: i.id, label: i.title })),
                  ]}
                >
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.instructions.filterAllInstructions}</SelectItem>
                    {instructions.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="date"
                    value={filterFrom}
                    max={filterTo || toDateStr(new Date())}
                    onChange={(e) => setFilterFrom(e.target.value)}
                    className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                  />
                  <span className="text-caption-airbnb text-muted-foreground">—</span>
                  <input
                    type="date"
                    value={filterTo}
                    min={filterFrom}
                    max={toDateStr(new Date())}
                    onChange={(e) => setFilterTo(e.target.value)}
                    className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                  />
                </div>
              </div>

              {!loadingRecords && records.length === 0 && (
                <SpringCard hover={false}>
                  <p className="text-body-airbnb text-muted-foreground">{t.instructions.emptyLog}</p>
                </SpringCard>
              )}

              {/* Мобильная раскладка — трёхстрочные карточки (docs/spec/07-instructions.md, "Макеты и вёрстка") */}
              <div className="flex flex-col gap-2 md:hidden">
                {records.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRecord(r)}
                    className="flex items-center gap-3 rounded-card border border-border bg-card p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body-airbnb font-medium">
                        {r.lastName} {r.firstName}
                      </div>
                      <div className="truncate text-caption-airbnb">
                        {new Date(r.createdAt).toLocaleString()} · {r.instructionTitle}
                      </div>
                      <div
                        className={cn(
                          "truncate text-caption-airbnb",
                          (r.isStale || r.isSuspiciouslyFast) && "font-semibold text-warning"
                        )}
                      >
                        {t.instructions.readMinutesShort.replace("{count}", String(Math.round(r.readingSeconds / 60)))} · v{r.versionNumber}
                        {r.isStale ? ` · ${t.instructions.staleLabel}` : ""}
                        {r.isSuspiciouslyFast ? ` · ${t.instructions.suspiciouslyFastLabel}` : ""}
                      </div>
                    </div>
                    <a
                      href={`/api/instructions/records/${r.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex size-9.5 shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground"
                      aria-label={t.instructions.downloadPdfButton}
                    >
                      <Download className="size-4" />
                    </a>
                  </button>
                ))}
              </div>

              {/* Десктопная раскладка — полная таблица */}
              <div className="hidden overflow-x-auto rounded-card border border-border md:block">
                <table className="w-full text-left text-caption-airbnb">
                  <thead className="border-b border-border bg-muted/40 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
                    <tr>
                      {[
                        t.instructions.colDate,
                        t.instructions.colFullName,
                        t.instructions.colPhone,
                        t.instructions.colBirthDate,
                        t.instructions.colReadingTime,
                        t.instructions.colIp,
                        t.instructions.colDevice,
                        t.instructions.colBrowser,
                        t.instructions.colVersion,
                        t.instructions.colPdf,
                      ].map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{new Date(r.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-foreground">
                          {r.lastName} {r.firstName}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.phone}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{new Date(r.birthDate).toLocaleDateString()}</td>
                        <td className={cn("px-3 py-2 whitespace-nowrap tabular-nums", r.isSuspiciouslyFast && "font-semibold text-warning")}>
                          {t.instructions.readMinutesShort.replace("{count}", String(Math.round(r.readingSeconds / 60)))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.ip}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.deviceLabel ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.browserLabel ?? "—"}</td>
                        <td className={cn("px-3 py-2 whitespace-nowrap", r.isStale && "font-semibold text-warning")}>
                          v{r.versionNumber}
                          {r.isStale ? ` · ${t.instructions.staleLabel}` : ""}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <a href={`/api/instructions/records/${r.id}/pdf`} target="_blank" rel="noreferrer" className="text-primary">
                            <Download className="size-4" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="flex flex-col gap-3 pt-2 pb-1">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.instructions.createSheetTitle}</h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="instructionTitle">{t.instructions.titleLabel}</Label>
            <Input
              id="instructionTitle"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t.instructions.titlePlaceholder}
              autoFocus
            />
          </div>
          <PressableScale>
            <Button type="button" className="w-full" onClick={createInstruction} disabled={creating || !newTitle.trim()}>
              {t.instructions.createButton}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>

      <BottomSheet
        open={kebabTarget !== null}
        onClose={() => {
          setKebabTarget(null);
          setKebabView("menu");
          setDeleteError(null);
        }}
      >
        {kebabTarget && kebabView === "menu" && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{kebabTarget.title}</h2>
            <ActionSheetItem
              icon={FileText}
              onClick={() => {
                router.push(`/settings/instructions/${kebabTarget.id}`);
                setKebabTarget(null);
              }}
            >
              {t.instructions.editAction}
            </ActionSheetItem>
            {kebabTarget.status === "published" && (
              <ActionSheetItem
                icon={Link2}
                onClick={() => {
                  copyLink(kebabTarget);
                  setQrTarget(kebabTarget);
                  setKebabTarget(null);
                }}
              >
                {t.instructions.linkAndQrAction}
              </ActionSheetItem>
            )}
            {kebabTarget.status !== "archived" && (
              <ActionSheetItem icon={Send} destructive onClick={() => setKebabView("confirm-archive")}>
                {t.instructions.archiveAction}
              </ActionSheetItem>
            )}
            <ActionSheetItem
              icon={Trash2}
              destructive
              disabled={kebabTarget.recordsCount > 0}
              onClick={() => setKebabView("confirm-delete")}
            >
              {t.instructions.deleteAction}
            </ActionSheetItem>
            {kebabTarget.recordsCount > 0 && (
              <p className="pt-1 text-caption-airbnb text-muted-foreground">{t.instructions.deleteBlockedHint}</p>
            )}
          </div>
        )}
        {kebabTarget && kebabView === "confirm-archive" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.instructions.archiveConfirmTitle}</h2>
            <p className="text-body-airbnb text-muted-foreground">{t.instructions.archiveConfirmHint}</p>
            <PressableScale>
              <Button type="button" variant="destructive" className="w-full" onClick={archiveInstruction}>
                {t.instructions.archiveAction}
              </Button>
            </PressableScale>
            <PressableScale>
              <Button type="button" variant="outline" className="w-full" onClick={() => setKebabView("menu")}>
                {t.common.cancel}
              </Button>
            </PressableScale>
          </div>
        )}
        {kebabTarget && kebabView === "confirm-delete" && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.instructions.deleteConfirmTitle}</h2>
            <p className="text-body-airbnb text-muted-foreground">{t.instructions.deleteConfirmHint}</p>
            {deleteError && <p className="text-caption-airbnb text-destructive">{deleteError}</p>}
            <PressableScale>
              <Button type="button" variant="destructive" className="w-full" onClick={deleteInstruction}>
                {t.instructions.deleteAction}
              </Button>
            </PressableScale>
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setKebabView("menu");
                  setDeleteError(null);
                }}
              >
                {t.common.cancel}
              </Button>
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      {qrTarget && (
        <InstructionQrSheet open={qrTarget !== null} onClose={() => setQrTarget(null)} title={qrTarget.title} url={publicUrl(qrTarget)} />
      )}

      <AcknowledgmentRecordSheet
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onChanged={() => {
          loadRecords();
          setSelectedRecord(null);
        }}
      />

      {copiedId && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-caption-airbnb font-semibold text-background shadow-lg md:bottom-6">
          {t.instructions.linkCopiedToast}
        </div>
      )}
    </OwnerShell>
  );
}
