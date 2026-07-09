"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { WheelTimePicker } from "@/components/wheel-time-picker";

export default function WorkTimeSettingsPage() {
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/work-time-settings")
      .then((res) => res.json())
      .then((data) => {
        const [h, m] = String(data.defaultShiftStartTime ?? "10:00").split(":").map(Number);
        setHour(h);
        setMinute(m);
        setChecking(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      await fetch("/api/tenant/work-time-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultShiftStartTime: time }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-caption-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="text-screen-title">{t.settings.workTimeTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.settings.workTimeHint}</p>

          <SpringCard animate={false} hover={false} className="flex flex-col items-center gap-4">
            <Label>{t.settings.defaultShiftStartLabel}</Label>
            <WheelTimePicker hour={hour} minute={minute} onChange={(v) => { setHour(v.hour); setMinute(v.minute); }} />
            {saved && <p className="text-body-airbnb text-success">{t.common.save}</p>}
            <PressableScale className="w-full">
              <Button type="button" className="w-full" disabled={saving} onClick={save}>
                {t.common.save}
              </Button>
            </PressableScale>
          </SpringCard>
        </div>
      </div>
    </OwnerShell>
  );
}
