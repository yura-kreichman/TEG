"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

const EMAIL_LIST_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+(\s*,\s*[^\s@]+@[^\s@]+\.[^\s@]+)*$/;

export function EmailChannelSheet({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useI18n();
  const [smtpConfigured, setSmtpConfigured] = useState(true);
  const [addresses, setAddresses] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestResult(null);
    fetch("/api/tenant/summary-channels/email")
      .then((res) => res.json())
      .then((data) => {
        setSmtpConfigured(data.smtpConfigured);
        setAddresses(data.emailAddresses ?? "");
      });
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSave() {
    if (addresses.trim() && !EMAIL_LIST_PATTERN.test(addresses.trim())) {
      setError(t.summaries.emailInvalidAddress);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/tenant/summary-channels/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAddresses: addresses, enabled: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.summaries.genericError);
        return;
      }
      onChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/tenant/summary-channels/email/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error ?? t.summaries.genericError });
        return;
      }
      const first = addresses.split(",")[0]?.trim() ?? "";
      setTestResult({
        ok: true,
        message: `${t.summaries.emailTestOkPrefix} ${first}. ${t.summaries.emailTestOkSuffix}`,
      });
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-1 pt-2 pb-1">
        <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.summaries.emailSheetTitle}</h2>
        <p className="mb-3 text-caption-airbnb">{t.summaries.emailSheetSub}</p>

        {!smtpConfigured && (
          <p className="mb-3 rounded-control bg-warning/15 p-3 text-body-airbnb text-warning">
            {t.summaries.emailNotConfiguredHint}
          </p>
        )}

        <div className="mb-3.5 flex flex-col gap-1">
          <Label htmlFor="summaryEmailAddr">{t.summaries.emailAddressLabel}</Label>
          <Input
            id="summaryEmailAddr"
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder={t.summaries.emailAddressPlaceholder}
          />
          <span className="text-caption-airbnb">{t.summaries.emailAddressHint}</span>
        </div>
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

        <PressableScale>
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={handleTest}
            disabled={testLoading || !addresses.trim() || !smtpConfigured}
          >
            {testLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {testLoading ? t.summaries.testSending : t.summaries.emailTestButton}
          </Button>
        </PressableScale>

        {testResult && (
          <p
            className={cn(
              "mt-2.5 rounded-control p-3 text-body-airbnb",
              testResult.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
            )}
          >
            {testResult.message}
          </p>
        )}

        <PressableScale className="mt-3.5">
          <Button type="button" className="w-full" onClick={handleSave} disabled={saving}>
            {t.summaries.saveButton}
          </Button>
        </PressableScale>
      </div>
    </BottomSheet>
  );
}
