"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Clock, DollarSign, FileText, Landmark, Pencil, Send, ShoppingCart, Zap } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TelegramConnectSheet } from "@/components/summary-telegram-connect-sheet";
import { useI18n } from "@/components/i18n-provider";

interface TelegramStatus {
  botConfigured: boolean;
  connected: boolean;
  enabled: boolean;
  chatTitle: string | null;
}

// Рабочий чат сотрудников — отдельный экран (запрос пользователя 2026-07-24:
// "по аналогии, как с Push-уведомлениями"), тут же и типы сводок
// (Zoна/Касса/Закрытие смены/Инструктаж), раньше жившие отдельными
// карточками на общем списке /settings/summaries — они актуальны именно тут,
// это содержимое, которое рассылается через ЭТОТ чат.
export default function StaffTelegramSettingsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [zoneEnabled, setZoneEnabled] = useState(false);
  const [dailyCashEnabled, setDailyCashEnabled] = useState(false);
  const [shiftCloseEnabled, setShiftCloseEnabled] = useState(false);
  const [instructionAckEnabled, setInstructionAckEnabled] = useState(false);
  const [expenseEnabled, setExpenseEnabled] = useState(false);
  const [collectionEnabled, setCollectionEnabled] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  async function loadAll() {
    const [tgRes, zoneRes, dcRes, scRes, iaRes, exRes, colRes] = await Promise.all([
      fetch("/api/tenant/summary-channels/telegram/status"),
      fetch("/api/tenant/summary-settings/zone"),
      fetch("/api/tenant/summary-settings/daily-cash"),
      fetch("/api/tenant/summary-settings/shift-close"),
      fetch("/api/tenant/summary-settings/instruction-ack"),
      fetch("/api/tenant/summary-settings/expense"),
      fetch("/api/tenant/summary-settings/collection"),
    ]);
    if (tgRes.status === 401) {
      router.replace("/login");
      return;
    }
    setTelegram(await tgRes.json());
    setZoneEnabled((await zoneRes.json()).enabled);
    setDailyCashEnabled((await dcRes.json()).enabled);
    setShiftCloseEnabled((await scRes.json()).enabled);
    setInstructionAckEnabled((await iaRes.json()).enabled);
    setExpenseEnabled((await exRes.json()).enabled);
    setCollectionEnabled((await colRes.json()).enabled);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  async function toggleExpense(next: boolean) {
    setExpenseEnabled(next);
    await fetch("/api/tenant/summary-settings/expense", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function toggleCollection(next: boolean) {
    setCollectionEnabled(next);
    await fetch("/api/tenant/summary-settings/collection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  if (checking || !telegram) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <BackLink label={t.summaries.listTitle} href="/settings/summaries" className="mb-2" />
          <h1 className="text-screen-title">{t.summaries.telegramStaffLabel}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.telegramStaffSub}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
                {/* "изменить" — обычная белая кнопка с иконкой, в один ряд
                    с названием чата (запрос пользователя 2026-07-25), не
                    отдельной строкой ниже. Не подключён — крупная кнопка
                    вместо неё (запрос пользователя 2026-07-24: "нет
                    удобного bottom sheet для подключения") — первый шаг
                    должен быть заметным. Тумблер вкл/выкл — на списке
                    "Сводки и сообщения", не здесь (запрос того же дня:
                    дублировать не нужно). */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                      <Send className="size-4" />
                    </div>
                    <div className="min-w-0 truncate text-body-airbnb font-medium">
                      {telegram.connected ? `«${telegram.chatTitle}»` : t.summaries.telegramNotConnected}
                    </div>
                  </div>
                  {telegram.connected && (
                    <PressableScale className="shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={t.summaries.telegramChangeLink}
                        onClick={() => setConnectOpen(true)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </PressableScale>
                  )}
                </div>
                {!telegram.connected && (
                  <PressableScale>
                    <Button type="button" className="w-full gap-2" onClick={() => setConnectOpen(true)}>
                      <Send className="size-4" />
                      {t.summaries.connectButton}
                    </Button>
                  </PressableScale>
                )}
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

            {/* Новый расход (запрос владельца 2026-08-15) — уведомление в
                момент ввода расхода Сотрудником, не часть сводки за день:
                та же карточка-тумблер, что у Инструктажа выше. */}
            <StaggerItem>
              <SpringCard animate={false} className="flex items-center gap-3.5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShoppingCart className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-body-airbnb font-bold">{t.summaries.expenseCardTitle}</div>
                  <div className="text-caption-airbnb">{t.summaries.expenseCardSub}</div>
                </div>
                <Switch checked={expenseEnabled} onCheckedChange={toggleExpense} className="shrink-0" />
              </SpringCard>
            </StaggerItem>

            {/* Инкассация (запрос владельца 2026-08-16) — раньше о ней знал
                только Push, в чате команды её не было видно. */}
            <StaggerItem>
              <SpringCard animate={false} className="flex items-center gap-3.5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Landmark className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-body-airbnb font-bold">{t.summaries.collectionCardTitle}</div>
                  <div className="text-caption-airbnb">{t.summaries.collectionCardSub}</div>
                </div>
                <Switch checked={collectionEnabled} onCheckedChange={toggleCollection} className="shrink-0" />
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>

      <TelegramConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} onChanged={loadAll} />
    </OwnerShell>
  );
}
