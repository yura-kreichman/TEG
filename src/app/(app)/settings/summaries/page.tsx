"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, ChevronRight, Clock, DollarSign, FileText, Mail, Send, Zap } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Switch } from "@/components/ui/switch";
import { TelegramConnectSheet } from "@/components/summary-telegram-connect-sheet";
import { EmailChannelSheet } from "@/components/summary-email-sheet";
import { useI18n } from "@/components/i18n-provider";
import { isPushSupported, getPushSubscription } from "@/lib/push-client";

interface TelegramStatus {
  botConfigured: boolean;
  connected: boolean;
  enabled: boolean;
  chatTitle: string | null;
}

interface EmailStatus {
  smtpConfigured: boolean;
  enabled: boolean;
  emailAddresses: string;
}

export default function SummariesListPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [zoneEnabled, setZoneEnabled] = useState(false);
  const [dailyCashEnabled, setDailyCashEnabled] = useState(false);
  const [shiftCloseEnabled, setShiftCloseEnabled] = useState(false);
  const [instructionAckEnabled, setInstructionAckEnabled] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [emailSheetOpen, setEmailSheetOpen] = useState(false);
  // Push — не тенантный toggle как Telegram/email (нет единого "chatId"),
  // а подписка конкретного устройства (фидбек пользователя 2026-07-12:
  // "Push-уведомления должны быть в Сводке с итогами, как Канал Доставки") —
  // статус берём прямо у браузера, полное управление (per-тип тумблеры,
  // подписать/отписать это устройство) — на отдельном экране /settings/push.
  const [pushSubscribed, setPushSubscribed] = useState(false);

  async function loadAll() {
    const [tgRes, emailRes, zoneRes, dcRes, scRes, iaRes] = await Promise.all([
      fetch("/api/tenant/summary-channels/telegram/status"),
      fetch("/api/tenant/summary-channels/email"),
      fetch("/api/tenant/summary-settings/zone"),
      fetch("/api/tenant/summary-settings/daily-cash"),
      fetch("/api/tenant/summary-settings/shift-close"),
      fetch("/api/tenant/summary-settings/instruction-ack"),
    ]);
    if (tgRes.status === 401) {
      router.replace("/login");
      return;
    }
    setTelegram(await tgRes.json());
    setEmail(await emailRes.json());
    setZoneEnabled((await zoneRes.json()).enabled);
    setDailyCashEnabled((await dcRes.json()).enabled);
    setShiftCloseEnabled((await scRes.json()).enabled);
    setInstructionAckEnabled((await iaRes.json()).enabled);
    if (isPushSupported()) {
      setPushSubscribed(!!(await getPushSubscription()));
    }
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function toggleTelegram(next: boolean) {
    setTelegram((prev) => (prev ? { ...prev, enabled: next } : prev));
    await fetch("/api/tenant/summary-channels/telegram", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function toggleEmail(next: boolean) {
    setEmail((prev) => (prev ? { ...prev, enabled: next } : prev));
    await fetch("/api/tenant/summary-channels/email", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function toggleZone(next: boolean) {
    setZoneEnabled(next);
    await fetch("/api/tenant/summary-settings/zone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function toggleDailyCash(next: boolean) {
    setDailyCashEnabled(next);
    await fetch("/api/tenant/summary-settings/daily-cash", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function toggleShiftClose(next: boolean) {
    setShiftCloseEnabled(next);
    await fetch("/api/tenant/summary-settings/shift-close", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function toggleInstructionAck(next: boolean) {
    setInstructionAckEnabled(next);
    await fetch("/api/tenant/summary-settings/instruction-ack", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  if (checking || !telegram || !email) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            {t.summaries.backToSettings}
          </Link>
          <h1 className="text-screen-title">{t.summaries.listTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.listSubtitle}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-3 text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.channelsCardLabel}
                </span>

                <div className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                      <Send className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-body-airbnb font-medium">{t.summaries.telegramLabel}</div>
                      <div className="truncate text-caption-airbnb">
                        {telegram.connected ? `«${telegram.chatTitle}»` : t.summaries.telegramNotConnected}{" "}
                        <button
                          type="button"
                          onClick={() => setConnectOpen(true)}
                          className="font-semibold text-primary"
                        >
                          {t.summaries.telegramChangeLink}
                        </button>
                      </div>
                    </div>
                  </div>
                  {telegram.connected && (
                    <Switch checked={telegram.enabled} onCheckedChange={toggleTelegram} className="shrink-0" />
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border py-2 pt-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Mail className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-body-airbnb font-medium">{t.summaries.emailLabel}</div>
                      <div className="truncate text-caption-airbnb">
                        {email.emailAddresses ? email.emailAddresses.split(",")[0]?.trim() : t.summaries.emailNotConnected}{" "}
                        <button
                          type="button"
                          onClick={() => setEmailSheetOpen(true)}
                          className="font-semibold text-primary"
                        >
                          {t.summaries.telegramChangeLink}
                        </button>
                      </div>
                    </div>
                  </div>
                  <Switch checked={email.enabled} onCheckedChange={toggleEmail} className="shrink-0" />
                </div>

                <div
                  className="flex cursor-pointer items-center justify-between gap-3 border-t border-border py-2 pt-3"
                  onClick={() => router.push("/settings/push")}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Bell className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-body-airbnb font-medium">{t.pushSettings.title}</div>
                      <div className="truncate text-caption-airbnb">
                        {pushSubscribed ? t.summaries.pushOnThisDevice : t.summaries.pushNotConnected}{" "}
                        <span className="font-semibold text-primary">{t.summaries.telegramChangeLink}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                </div>
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <PressableScale>
                <SpringCard
                  animate={false}
                  className="flex cursor-pointer items-center gap-3.5"
                  onClick={() => router.push("/settings/summaries/zone")}
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Zap className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-airbnb font-bold">{t.summaries.zoneCardTitle}</div>
                    <div className="text-caption-airbnb">{t.summaries.zoneCardSub}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <Switch checked={zoneEnabled} onCheckedChange={toggleZone} />
                  </span>
                </SpringCard>
              </PressableScale>
            </StaggerItem>

            <StaggerItem>
              <PressableScale>
                <SpringCard
                  animate={false}
                  className="flex cursor-pointer items-center gap-3.5"
                  onClick={() => router.push("/settings/summaries/daily-cash")}
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <DollarSign className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-airbnb font-bold">{t.summaries.dailyCashCardTitle}</div>
                    <div className="text-caption-airbnb">{t.summaries.dailyCashCardSub}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <Switch checked={dailyCashEnabled} onCheckedChange={toggleDailyCash} />
                  </span>
                </SpringCard>
              </PressableScale>
            </StaggerItem>

            <StaggerItem>
              <PressableScale>
                <SpringCard
                  animate={false}
                  className="flex cursor-pointer items-center gap-3.5"
                  onClick={() => router.push("/settings/summaries/shift-close")}
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Clock className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-airbnb font-bold">{t.summaries.shiftCloseCardTitle}</div>
                    <div className="text-caption-airbnb">{t.summaries.shiftCloseCardSub}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <Switch checked={shiftCloseEnabled} onCheckedChange={toggleShiftClose} />
                  </span>
                </SpringCard>
              </PressableScale>
            </StaggerItem>

            {/* Единственное булево поле (docs/spec/07-instructions.md, доп.
                решение 2026-07-12) — само сообщение не настраивается, поэтому
                без перехода на отдельный экран, в отличие от карточек выше. */}
            <StaggerItem>
              <SpringCard animate={false} className="flex items-center gap-3.5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-body-airbnb font-bold">{t.summaries.instructionAckCardTitle}</div>
                  <div className="text-caption-airbnb">{t.summaries.instructionAckCardSub}</div>
                </div>
                <Switch checked={instructionAckEnabled} onCheckedChange={toggleInstructionAck} className="shrink-0" />
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>

      <TelegramConnectSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onChanged={loadAll}
      />
      <EmailChannelSheet open={emailSheetOpen} onClose={() => setEmailSheetOpen(false)} onChanged={loadAll} />
    </OwnerShell>
  );
}
