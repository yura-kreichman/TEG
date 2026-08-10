"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/components/i18n-provider";

interface SystemSettingsConfig {
  telegramBotToken: string;
  smtp: { host: string; port: string; user: string; password: string; from: string; fromName: string };
  vapid: { publicKey: string; privateKey: string; subject: string };
  // chatId/chatTitle только читаются: их пишет привязка через бота, форма
  // управляет лишь тумблерами (см. PATCH /api/admin/settings).
  adminNotifications: { chatId: string; chatTitle: string; newOwner: boolean; payment: boolean; deletion: boolean };
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

  // Привязка группы платформы: код одноразовый и живёт 15 минут, поэтому
  // держится только в состоянии страницы — перезагрузил, значит запросил новый.
  const [bindCode, setBindCode] = useState<{ code: string; link: string | null } | null>(null);
  const [groupStatus, setGroupStatus] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);

  const [vapidStatus, setVapidStatus] = useState<string | null>(null);
  const [vapidGenerating, setVapidGenerating] = useState(false);

  const [currentLogin, setCurrentLogin] = useState("");
  const [newLogin, setNewLogin] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/settings");
    if (res.status === 401) {
      router.replace("/admin/login");
      return;
    }
    setConfig(await res.json());

    const accountRes = await fetch("/api/admin/account");
    if (accountRes.ok) {
      const data = await accountRes.json();
      setCurrentLogin(data.login ?? "");
      setNewLogin(data.login ?? "");
    }

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

  async function generateVapidKeys() {
    setVapidStatus(null);
    setVapidGenerating(true);
    try {
      const res = await fetch("/api/admin/settings/generate-vapid-keys", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setVapidStatus(data.error ?? t.admin.genericError);
        return;
      }
      // Приватный ключ бэкенд не возвращает (нет смысла показывать его дважды —
      // подставляем placeholder, реальное значение уже сохранено в БД) —
      // перечитываем конфиг целиком, чтобы форма не разошлась с БД.
      const configRes = await fetch("/api/admin/settings");
      setConfig(await configRes.json());
      setVapidStatus(t.admin.vapidGenerated);
    } finally {
      setVapidGenerating(false);
    }
  }

  async function saveCredentials() {
    setCredentialsError(null);

    if (newPassword && newPassword !== confirmPassword) {
      setCredentialsError(t.admin.passwordsMismatch);
      return;
    }
    if (!currentPassword.trim()) {
      setCredentialsError(t.admin.currentPasswordRequired);
      return;
    }

    setCredentialsSaving(true);
    try {
      const res = await fetch("/api/admin/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newLogin: newLogin.trim() !== currentLogin ? newLogin.trim() : undefined,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCredentialsError(data.error ?? t.admin.genericError);
        return;
      }
      setCurrentLogin(data.login);
      setNewLogin(data.login);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCredentialsSaved(true);
      setTimeout(() => setCredentialsSaved(false), 1500);
    } finally {
      setCredentialsSaving(false);
    }
  }

  async function connectGroup() {
    setGroupStatus(null);
    setGroupBusy(true);
    try {
      const res = await fetch("/api/admin/settings/telegram-group", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setGroupStatus(data.error ?? t.admin.genericError);
        return;
      }
      setBindCode({ code: data.code, link: data.link ?? null });
    } finally {
      setGroupBusy(false);
    }
  }

  async function unbindGroup() {
    setGroupStatus(null);
    setGroupBusy(true);
    try {
      const res = await fetch("/api/admin/settings/telegram-group", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setGroupStatus(data?.error ?? t.admin.genericError);
        return;
      }
      setBindCode(null);
      await load();
    } finally {
      setGroupBusy(false);
    }
  }

  async function testGroup() {
    setGroupStatus(null);
    setGroupBusy(true);
    try {
      const res = await fetch("/api/admin/settings/telegram-group", { method: "PUT" });
      const data = await res.json().catch(() => null);
      setGroupStatus(res.ok ? t.admin.notifyTestSent : (data?.error ?? t.admin.genericError));
    } finally {
      setGroupBusy(false);
    }
  }

  if (checking || !config) return null;

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-4">
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
            <div className="text-card-title">{t.admin.notifySectionTitle}</div>
            <p className="mt-1 text-caption-airbnb">{t.admin.notifySectionSub}</p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {config.adminNotifications.chatId ? (
                <p className="text-caption-airbnb">
                  {t.admin.notifyConnectedTo}{" "}
                  <span className="font-semibold text-foreground">
                    {config.adminNotifications.chatTitle || config.adminNotifications.chatId}
                  </span>
                </p>
              ) : (
                <p className="text-caption-airbnb">{t.admin.notifyNotConnected}</p>
              )}

              <Button type="button" variant="outline" size="sm" disabled={groupBusy} onClick={connectGroup}>
                {t.admin.notifyConnectButton}
              </Button>

              {config.adminNotifications.chatId && (
                <>
                  <Button type="button" variant="outline" size="sm" disabled={groupBusy} onClick={testGroup}>
                    {t.admin.notifyTestButton}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={groupBusy} onClick={unbindGroup}>
                    {t.admin.notifyUnbindButton}
                  </Button>
                </>
              )}

              {groupStatus && <p className="text-caption-airbnb">{groupStatus}</p>}
            </div>

            {/* Код показывается только что созданный — он одноразовый и живёт
                15 минут, хранить его негде и незачем. */}
            {bindCode && (
              <div className="mt-3 rounded-card bg-surface-0 p-3">
                <p className="text-caption-airbnb">{t.admin.notifyCodeHint}</p>
                <p className="mt-1 text-card-title tracking-widest">{bindCode.code}</p>
                {bindCode.link && (
                  <a
                    href={bindCode.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-caption-airbnb font-semibold text-primary"
                  >
                    {t.admin.notifyOpenTelegram}
                  </a>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3">
              {(
                [
                  ["newOwner", t.admin.notifyEventNewOwner],
                  ["payment", t.admin.notifyEventPayment],
                  ["deletion", t.admin.notifyEventDeletion],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3">
                  <span className="text-caption-airbnb">{label}</span>
                  <Switch
                    checked={config.adminNotifications[key]}
                    onCheckedChange={(checked) =>
                      setConfig({
                        ...config,
                        adminNotifications: { ...config.adminNotifications, [key]: checked },
                      })
                    }
                  />
                </label>
              ))}
            </div>

            <p className="mt-3 text-caption-airbnb">{t.admin.notifyTicketsHint}</p>
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="smtp-from-name">{t.admin.smtpFromNameLabel}</Label>
                <Input
                  id="smtp-from-name"
                  placeholder={t.admin.smtpFromNamePlaceholder}
                  value={config.smtp.fromName}
                  onChange={(e) => setConfig({ ...config, smtp: { ...config.smtp, fromName: e.target.value } })}
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

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.vapidSectionTitle}</div>
            <p className="mb-3 text-caption-airbnb">{t.admin.vapidSectionSub}</p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="vapid-subject">{t.admin.vapidSubjectLabel}</Label>
                <Input
                  id="vapid-subject"
                  placeholder={t.admin.vapidSubjectPlaceholder}
                  value={config.vapid.subject}
                  onChange={(e) => setConfig({ ...config, vapid: { ...config.vapid, subject: e.target.value } })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="vapid-public-key">{t.admin.vapidPublicKeyLabel}</Label>
                <Input id="vapid-public-key" readOnly value={config.vapid.publicKey} className="font-mono text-xs" />
              </div>
              <div className="flex items-center gap-3 border-t border-border pt-3">
                <Button type="button" variant="outline" size="sm" disabled={vapidGenerating} onClick={generateVapidKeys}>
                  {vapidGenerating ? t.admin.testChecking : t.admin.vapidGenerateButton}
                </Button>
                {vapidStatus && <p className="text-caption-airbnb">{vapidStatus}</p>}
              </div>
              {config.vapid.publicKey && (
                <p className="text-caption-airbnb text-muted-foreground">{t.admin.vapidRegenerateWarning}</p>
              )}
            </div>
          </SpringCard>

          <SpringCard animate={false}>
            <div className="mb-3 text-card-title">{t.admin.credentialsSectionTitle}</div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="admin-login">{t.admin.loginFieldLabel}</Label>
                <Input id="admin-login" value={newLogin} onChange={(e) => setNewLogin(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="admin-new-password">{t.admin.newPasswordLabel}</Label>
                  <Input
                    id="admin-new-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t.admin.newPasswordPlaceholder}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="admin-confirm-password">{t.admin.confirmPasswordLabel}</Label>
                  <Input
                    id="admin-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <Label htmlFor="admin-current-password">{t.admin.currentPasswordLabel}</Label>
                <Input
                  id="admin-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              {credentialsError && <p className="text-sm text-destructive">{credentialsError}</p>}
              <SaveButton
                type="button"
                disabled={credentialsSaving || !currentPassword.trim()}
                onClick={saveCredentials}
                saved={credentialsSaved}
              >
                {credentialsSaving ? t.admin.testChecking : t.common.save}
              </SaveButton>
            </div>
          </SpringCard>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <SaveButton type="button" onClick={save} saved={saved} />
        </div>
      </div>
    </AdminShell>
  );
}
