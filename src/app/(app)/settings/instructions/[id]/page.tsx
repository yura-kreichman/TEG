"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InstructionEditor } from "@/components/instructions/instruction-editor";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { PMNode } from "@/lib/instructions/content";
import { useSavePulse } from "@/hooks/use-save-pulse";

const EMPTY_DOC: PMNode = { type: "doc", content: [] };

interface InstructionDetail {
  id: string;
  title: string;
  content: PMNode;
  status: "draft" | "published" | "archived";
  honestyCheck: boolean;
  currentVersionNumber: number;
}

export default function InstructionEditorPage() {
  const t = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [instruction, setInstruction] = useState<InstructionDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<PMNode>(EMPTY_DOC);
  const [honestyCheck, setHonestyCheck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { saved, pulse: savePulse } = useSavePulse(1500);

  useEffect(() => {
    fetch(`/api/instructions/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: InstructionDetail) => {
        setInstruction(data);
        setTitle(data.title);
        setContent(data.content ?? EMPTY_DOC);
        setHonestyCheck(data.honestyCheck);
      })
      .catch(() => router.replace("/settings/instructions"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveDraft() {
    setSaving(true);
    try {
      const res = await fetch(`/api/instructions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, honestyCheck }),
      });
      if (res.ok) savePulse();
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      await saveDraft();
      const res = await fetch(`/api/instructions/${id}/publish`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setInstruction((prev) => (prev ? { ...prev, status: "published", currentVersionNumber: data.versionNumber } : prev));
      }
    } finally {
      setPublishing(false);
    }
  }

  if (!instruction) return null;

  const statusLabel = {
    draft: t.instructions.statusDraft,
    published: t.instructions.statusPublished,
    archived: t.instructions.statusArchived,
  }[instruction.status];

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <Link href="/settings/instructions" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.instructions.settingsTitle}
          </Link>

          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor="instructionEditorTitle">{t.instructions.titleLabel}</Label>
              <Input id="instructionEditorTitle" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold",
                instruction.status === "published" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {statusLabel}
              {instruction.currentVersionNumber > 0 ? ` · v${instruction.currentVersionNumber}` : ""}
            </span>
          </div>

          <InstructionEditor content={content} onChange={setContent} editable={instruction.status !== "archived"} />

          <SpringCard hover={false} className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-body-airbnb font-medium">{t.instructions.honestyCheckLabel}</div>
              <div className="mt-0.5 text-caption-airbnb">{t.instructions.honestyCheckHint}</div>
            </div>
            <Switch checked={honestyCheck} onCheckedChange={setHonestyCheck} className="shrink-0" />
          </SpringCard>

          {instruction.status !== "archived" && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <PressableScale className="flex-1">
                <SaveButton
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={saveDraft}
                  disabled={saving || publishing}
                  saved={saved} />
              </PressableScale>
              <PressableScale className="flex-1">
                <Button type="button" className="w-full gap-2" onClick={publish} disabled={saving || publishing}>
                  <Send className="size-4" />
                  {t.instructions.publishButton}
                </Button>
              </PressableScale>
            </div>
          )}
        </div>
      </div>
    </OwnerShell>
  );
}
