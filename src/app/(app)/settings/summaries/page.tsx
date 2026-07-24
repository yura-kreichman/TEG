"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, ChevronRight, Mail, Pencil, Send } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmailChannelSheet } from "@/components/summary-email-sheet";
import { useI18n } from "@/components/i18n-provider";
import { isPushSupported, getPushSubscription } from "@/lib/push-client";

interface TelegramStatus {
  botConfigured: boolean;
  connected: boolean;
  enabled: boolean;
  chatTitle: string | null;
}

interface PublicGroupStatus {
  botConfigured: boolean;
  connected: boolean;
  enabled: boolean;
  chatTitle: string | null;
  inviteLink: string | null;
}

interface EmailStatus {
  smtpConfigured: boolean;
  enabled: boolean;
  emailAddresses: string;
}

// Список верхнего уровня — только КАНАЛЫ (куда доставляется), не типы сводок
// (запрос пользователя 2026-07-24: "перенести настройки сводок в Telegram
// для сотрудников по аналогии, как с Push-уведомлениями") — каждый канал со
// своей механикой ведёт на свой экран: Zoна/Касса/Закрытие смены/Инструктаж
// теперь живут внутри /settings/summaries/telegram, а не отдельными
// карточками тут.
export default function SummariesListPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [publicGroup, setPublicGroup] = useState<PublicGroupStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [emailSheetOpen, setEmailSheetOpen] = useState(false);
  // Push — не тенантный toggle как Telegram/email (нет единого "chatId"),
  // а подписка конкретного устройства (фидбек пользователя 2026-07-12:
  // "Push-уведомления должны быть в Сводке с итогами, как Канал Доставки") —
  // статус берём прямо у браузера, полное управление (per-тип тумблеры,
  // подписать/отписать это устройство) — на отдельном экране /settings/push.
  const [pushSubscribed, setPushSubscribed] = useState(false);

  async function loadAll() {
    const [tgRes, pgRes, emailRes] = await Promise.all([
      fetch("/api/tenant/summary-channels/telegram/status"),
      fetch("/api/tenant/public-group/telegram/status"),
      fetch("/api/tenant/summary-channels/email"),
    ]);
    if (tgRes.status === 401) {
      router.replace("/login");
      return;
    }
    setTelegram(await tgRes.json());
    setPublicGroup(await pgRes.json());
    setEmail(await emailRes.json());
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

  async function togglePublicGroup(next: boolean) {
    setPublicGroup((prev) => (prev ? { ...prev, enabled: next } : prev));
    await fetch("/api/tenant/public-group/telegram", {
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

  if (checking || !telegram || !publicGroup || !email) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <BackLink label={t.settings.title} href="/settings" className="mb-2" />
          <h1 className="text-screen-title">{t.summaries.listTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.listSubtitle}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-3 text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.channelsCardLabel}
                </span>

                {/* "Telegram для сотрудников" — строка-переход на свой
                    экран (запрос пользователя 2026-07-24: "по аналогии, как
                    с Push-уведомлениями"), там же и типы сводок, и
                    привязка/тумблер чата. Разбито на 2 строки, "изменить" —
                    обычная белая кнопка с иконкой, не текстовая ссылка
                    (запрос пользователя 2026-07-25: раньше всё это плюс
                    тумблер/шеврон теснились в одну строку и обрезались). */}
                <div className="flex flex-col gap-2 py-2">
                  <div
                    className="flex cursor-pointer items-center justify-between gap-3"
                    onClick={() => router.push("/settings/summaries/telegram")}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                        <Send className="size-4" />
                      </div>
                      <div className="min-w-0 text-body-airbnb font-medium">{t.summaries.telegramStaffLabel}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Тумблер независим от факта привязки чата (запрос
                          пользователя 2026-07-24: "настройки должны быть
                          независимо от того, подключена ли реальная
                          группа/чат или нет") — можно настроить заранее, до
                          подключения. */}
                      <span onClick={(e) => e.stopPropagation()}>
                        <Switch checked={telegram.enabled} onCheckedChange={toggleTelegram} />
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground/50" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-11.5">
                    <span className="truncate text-caption-airbnb text-muted-foreground">
                      {telegram.connected ? `«${telegram.chatTitle}»` : t.summaries.telegramNotConnected}
                    </span>
                    <PressableScale className="shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push("/settings/summaries/telegram");
                        }}
                      >
                        <Pencil className="size-3.5" />
                        {t.summaries.telegramChangeLink}
                      </Button>
                    </PressableScale>
                  </div>
                </div>

                {/* "Телеграм для клиентов" — публичная группа анонсов (запрос
                    пользователя 2026-07-24), отдельная от рабочего чата
                    сотрудников выше. */}
                <div className="flex flex-col gap-2 border-t border-border py-2 pt-3">
                  <div
                    className="flex cursor-pointer items-center justify-between gap-3"
                    onClick={() => router.push("/settings/summaries/public-group")}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                        <Send className="size-4" />
                      </div>
                      <div className="min-w-0 text-body-airbnb font-medium">{t.summaries.telegramClientsLabel}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span onClick={(e) => e.stopPropagation()}>
                        <Switch checked={publicGroup.enabled} onCheckedChange={togglePublicGroup} />
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground/50" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-11.5">
                    <span className="truncate text-caption-airbnb text-muted-foreground">
                      {publicGroup.connected ? `«${publicGroup.chatTitle}»` : t.summaries.telegramNotConnected}
                    </span>
                    <PressableScale className="shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push("/settings/summaries/public-group");
                        }}
                      >
                        <Pencil className="size-3.5" />
                        {t.summaries.telegramChangeLink}
                      </Button>
                    </PressableScale>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border py-2 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Mail className="size-4" />
                      </div>
                      <div className="min-w-0 text-body-airbnb font-medium">{t.summaries.emailLabel}</div>
                    </div>
                    <Switch checked={email.enabled} onCheckedChange={toggleEmail} className="shrink-0" />
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-11.5">
                    <span className="truncate text-caption-airbnb text-muted-foreground">
                      {email.emailAddresses ? email.emailAddresses.split(",")[0]?.trim() : t.summaries.emailNotConnected}
                    </span>
                    <PressableScale className="shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setEmailSheetOpen(true)}
                      >
                        <Pencil className="size-3.5" />
                        {t.summaries.telegramChangeLink}
                      </Button>
                    </PressableScale>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border py-2 pt-3">
                  <div
                    className="flex cursor-pointer items-center justify-between gap-3"
                    onClick={() => router.push("/settings/push")}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Bell className="size-4" />
                      </div>
                      <div className="min-w-0 text-body-airbnb font-medium">{t.pushSettings.title}</div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-11.5">
                    <span className="truncate text-caption-airbnb text-muted-foreground">
                      {pushSubscribed ? t.summaries.pushOnThisDevice : t.summaries.pushNotConnected}
                    </span>
                    <PressableScale className="shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => router.push("/settings/push")}
                      >
                        <Pencil className="size-3.5" />
                        {t.summaries.telegramChangeLink}
                      </Button>
                    </PressableScale>
                  </div>
                </div>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>

      <EmailChannelSheet open={emailSheetOpen} onClose={() => setEmailSheetOpen(false)} onChanged={loadAll} />
    </OwnerShell>
  );
}
