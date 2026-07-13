"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { OwnerShell } from "@/components/owner-shell";
import { isIOS } from "@/lib/browser-detect";
import { isPushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push-client";
import { PUSH_NOTIFICATION_DEFAULTS, type PushNotificationSettingsData } from "@/lib/summary-settings";
import { PushNotificationPreview } from "@/components/push-notification-preview";

type DeviceState = "checking" | "unsupported" | "subscribed" | "not-subscribed";

export default function PushSettingsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<PushNotificationSettingsData>(PUSH_NOTIFICATION_DEFAULTS);
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(true); // true до проверки — не мигаем подсказкой на гидрации
  const [onIOS, setOnIOS] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
    setOnIOS(isIOS());

    if (!isPushSupported()) {
      setDeviceState("unsupported");
    } else {
      getPushSubscription().then((sub) => setDeviceState(sub ? "subscribed" : "not-subscribed"));
    }

    fetch("/api/tenant/push/settings").then(async (res) => {
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      setSettings(await res.json());
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function patch(partial: Partial<PushNotificationSettingsData>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    fetch("/api/tenant/push/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  async function handleEnable() {
    setBusy(true);
    setError(null);
    const result = await subscribeToPush();
    setBusy(false);
    if (result.ok) {
      setDeviceState("subscribed");
    } else {
      setError(t.pushSettings.errors[result.error]);
    }
  }

  async function handleDisable() {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    setDeviceState("not-subscribed");
  }

  async function handleTest() {
    setTestSending(true);
    setTestStatus(null);
    try {
      const res = await fetch("/api/tenant/push/test", { method: "POST" });
      const data = await res.json();
      setTestStatus(res.ok ? t.pushSettings.testSent : (data.error ?? t.admin.genericError));
    } finally {
      setTestSending(false);
    }
  }

  const rows: Array<{ key: keyof PushNotificationSettingsData; label: string; sub: string }> = [
    { key: "zoneSummary", label: t.pushSettings.zoneLabel, sub: t.pushSettings.zoneSub },
    { key: "dailyCashSummary", label: t.pushSettings.dailyCashLabel, sub: t.pushSettings.dailyCashSub },
    { key: "shiftCloseSummary", label: t.pushSettings.shiftCloseLabel, sub: t.pushSettings.shiftCloseSub },
  ];

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings/summaries" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.summaries.listTitle}
          </Link>
          <h1 className="text-screen-title">{t.pushSettings.title}</h1>
          <p className="mb-4 text-caption-airbnb">{t.pushSettings.sub}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
                <span className="text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.pushSettings.deviceCardLabel}
                </span>

                {deviceState === "unsupported" && (
                  <p className="text-body-airbnb text-muted-foreground">
                    {onIOS && !isStandalone ? t.pushSettings.iosHint : t.pushSettings.unsupported}
                  </p>
                )}

                {deviceState !== "unsupported" && deviceState !== "checking" && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <PressableScale className="w-fit">
                        <Button
                          type="button"
                          variant={deviceState === "subscribed" ? "outline" : "default"}
                          disabled={busy}
                          onClick={deviceState === "subscribed" ? handleDisable : handleEnable}
                        >
                          {deviceState === "subscribed" ? t.pushSettings.disableButton : t.pushSettings.enableButton}
                        </Button>
                      </PressableScale>
                      {deviceState === "subscribed" && (
                        <PressableScale className="w-fit">
                          <Button type="button" variant="outline" disabled={testSending} onClick={handleTest}>
                            {testSending ? t.admin.testChecking : t.pushSettings.testButton}
                          </Button>
                        </PressableScale>
                      )}
                    </div>
                    {error && <p className="text-caption-airbnb text-destructive">{error}</p>}
                    {testStatus && <p className="text-caption-airbnb">{testStatus}</p>}
                    {onIOS && !isStandalone && deviceState === "not-subscribed" && (
                      <p className="text-caption-airbnb text-muted-foreground">{t.pushSettings.iosHint}</p>
                    )}
                  </>
                )}
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
                <span className="text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.pushSettings.previewCardLabel}
                </span>
                <PushNotificationPreview
                  title={t.pushSettings.previewTitle}
                  body={t.pushSettings.previewBody}
                  time={t.pushSettings.previewTime}
                />
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-1 text-[11px] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.pushSettings.compositionCardLabel}
                </span>
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
                    <div className="min-w-0">
                      <div className="text-body-airbnb">{row.label}</div>
                      <div className="text-caption-airbnb">{row.sub}</div>
                    </div>
                    <Switch
                      checked={settings[row.key]}
                      onCheckedChange={(v) => patch({ [row.key]: v })}
                      className="shrink-0"
                    />
                  </div>
                ))}
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
