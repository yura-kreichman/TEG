"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";

interface SystemSettingsConfig {
  telegramBotToken: string;
  smtp: { host: string; port: string; user: string; password: string; from: string };
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [config, setConfig] = useState<SystemSettingsConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailStatus, setTestEmailStatus] = useState<string | null>(null);
  const [testEmailSending, setTestEmailSending] = useState(false);

  const [testTelegramStatus, setTestTelegramStatus] = useState<string | null>(null);
  const [testTelegramChecking, setTestTelegramChecking] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/settings");
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    setConfig(await res.json());
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save(): Promise<boolean> {
    if (!config) return false;
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? t.admin.genericError);
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    return true;
  }

  // Сначала сохраняем текущую форму, потом тестируем — иначе тест бил бы по
  // ещё не сохранённым в БД значениям.
  async function sendTestEmail() {
    if (!testEmailTo.trim()) return;
    setTestEmailStatus(null);
    setTestEmailSending(true);
    try {
      if (!(await save())) return;
      const res = await fetch("/api/admin/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmailTo.trim() }),
      });
      const data = await res.json();
      setTestEmailStatus(res.ok ? t.admin.testEmailSent : (data.error ?? t.admin.genericError));
    } finally {
      setTestEmailSending(false);
    }
  }

  async function testTelegramToken() {
    setTestTelegramStatus(null);
    setTestTelegramChecking(true);
    try {
      if (!(await save())) return;
      const res = await fetch("/api/admin/settings/test-telegram", { method: "POST" });
      const data = await res.json();
      setTestTelegramStatus(res.ok ? `${t.admin.testTelegramOk} @${data.username}` : (data.error ?? t.admin.genericError));
    } finally {
      setTestTelegramChecking(false);
    }
  }

  if (checking || !config) return null;

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <h1 className="text-screen-title">{t.admin.settingsTitle}</h1>
          <p className="text-caption-airbnb">{t.admin.settingsSub}</p>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.telegramSectionTitle}</div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="tg-token">{t.admin.telegramBotTokenLabel}</Label>
              <Input
                id="tg-token"
                value={config.telegramBotToken}
                onChange={(e) => setConfig({ ...config, telegramBotToken: e.target.value })}
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={testTelegramChecking || !config.telegramBotToken.trim()} onClick={testTelegramToken}>
                {testTelegramChecking ? t.admin.testChecking : t.admin.testTelegramButton}
              </Button>
              {testTelegramStatus && <p className="text-caption-airbnb">{testTelegramStatus}</p>}
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.smtpSectionTitle}</div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="smtp-host">{t.admin.smtpHostLabel}</Label>
                  <Input
                    id="smtp-host"
                    value={config.smtp.host}
                    onChange={(e) => setConfig({ ...config, smtp: { ...config.smtp, host: e.target.value } })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="smtp-port">{t.admin.smtpPortLabel}</Label>
                  <Input
                    id="smtp-port"
                    inputMode="numeric"
                    className="tabular-nums"
                    value={config.smtp.port}
                    onChange={(e) => setConfig({ ...config, smtp: { ...config.smtp, port: e.target.value } })}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="smtp-user">{t.admin.smtpUserLabel}</Label>
                <Input
                  id="smtp-user"
                  value={config.smtp.user}
                  onChange={(e) => setConfig({ ...config, smtp: { ...config.smtp, user: e.target.value } })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="smtp-password">{t.admin.smtpPasswordLabel}</Label>
                <Input
                  id="smtp-password"
                  type="password"
                  value={config.smtp.password}
                  onChange={(e) => setConfig({ ...config, smtp: { ...config.smtp, password: e.target.value } })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="smtp-from">{t.admin.smtpFromLabel}</Label>
                <Input
                  id="smtp-from"
                  type="email"
                  value={config.smtp.from}
                  onChange={(e) => setConfig({ ...config, smtp: { ...config.smtp, from: e.target.value } })}
                />
              </div>
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <Label htmlFor="test-email-to">{t.admin.testEmailToLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    id="test-email-to"
                    type="email"
                    placeholder={t.admin.testEmailToPlaceholder}
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" disabled={testEmailSending || !testEmailTo.trim()} onClick={sendTestEmail}>
                    {testEmailSending ? t.admin.testChecking : t.admin.testEmailButton}
                  </Button>
                </div>
                {testEmailStatus && <p className="text-caption-airbnb">{testEmailStatus}</p>}
              </div>
            </div>
          </SpringCard>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={save}>
            {saved ? t.common.saved : t.common.save}
          </Button>
        </div>
      </div>
    </AdminShell>
  );
}
