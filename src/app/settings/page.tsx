"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { AccentPicker } from "@/components/accent-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeModePicker } from "@/components/theme-mode-picker";
import { LocalePicker } from "@/components/locale-picker";
import { useI18n } from "@/components/i18n-provider";

export default function SettingsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/telegram")
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        setConfigured(data.configured);
        setChatId(data.chatId ?? "");
        setChecking(false);
      });
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);

    try {
      const res = await fetch("/api/tenant/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить настройки");
        return;
      }
      setConfigured(true);
      setBotToken("");
      setSaved(true);
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-screen-title">{t.settings.title}</h1>

          <StaggerList className="flex flex-col gap-6">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-4">
                <div>
                  <h2 className="text-section-title">{t.settings.appearanceTitle}</h2>
                  <p className="text-caption-airbnb">{t.settings.appearanceHint}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-body-airbnb">{t.settings.themeModeLabel}</span>
                  <ThemeModePicker />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-body-airbnb">{t.settings.accentLabel}</span>
                  <AccentPicker />
                </div>
                <div className="flex items-center justify-between rounded-control bg-muted/40 p-3">
                  <span className="text-body-airbnb">{t.settings.localDeviceThemeLabel}</span>
                  <ThemeToggle />
                </div>
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-4">
                <div>
                  <h2 className="text-section-title">{t.settings.languageTitle}</h2>
                  <p className="text-caption-airbnb">{t.settings.languageHint}</p>
                </div>
                <LocalePicker />
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-4">
                <div>
                  <h2 className="text-section-title">{t.settings.telegramTitle}</h2>
                  <p className="text-caption-airbnb">
                    {configured ? t.settings.telegramConfigured : t.settings.telegramNotConfigured}
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="botToken">{t.settings.botTokenLabel}</Label>
                    <Input
                      id="botToken"
                      type="password"
                      placeholder={configured ? "••••••••" : ""}
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="chatId">{t.settings.chatIdLabel}</Label>
                    <Input
                      id="chatId"
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                      required
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  {saved && <p className="text-sm text-success">{t.settings.saved}</p>}
                  <PressableScale className="w-fit">
                    <Button type="submit" disabled={loading}>
                      {t.common.save}
                    </Button>
                  </PressableScale>
                </form>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
