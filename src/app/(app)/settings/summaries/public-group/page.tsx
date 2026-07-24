"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MapPin, Package, Pencil, Send, Zap } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TelegramConnectSheet } from "@/components/summary-telegram-connect-sheet";
import { useI18n } from "@/components/i18n-provider";

interface PublicGroupStatus {
  botConfigured: boolean;
  connected: boolean;
  enabled: boolean;
  chatTitle: string | null;
  inviteLink: string | null;
  announceNewZones: boolean;
  announceNewPoints: boolean;
  announceNewAssets: boolean;
}

// Отдельный экран, а не строка в общем списке "Каналы доставки" (запрос
// пользователя 2026-07-24: "перенести... по аналогии, как с Push-
// уведомлениями") — та же механика, что /settings/push: строка-переход с
// превью статуса в списке, полное управление (привязка/тумблер/ссылка-
// приглашение/анонсы) здесь. Все настройки на этом экране действуют
// НЕЗАВИСИМО от факта подключения чата (запрос того же дня: "настройки...
// должны быть независимо от того, подключена ли реальная группа или нет") —
// можно всё преднастроить заранее, чат привязывается отдельным шагом.
export default function PublicGroupSettingsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [group, setGroup] = useState<PublicGroupStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  async function loadStatus() {
    const res = await fetch("/api/tenant/public-group/telegram/status");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = await res.json();
    setGroup(data);
    setChecking(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function patch(partial: Partial<Pick<PublicGroupStatus, "enabled" | "announceNewZones" | "announceNewPoints" | "announceNewAssets">>) {
    setGroup((prev) => (prev ? { ...prev, ...partial } : prev));
    fetch("/api/tenant/public-group/telegram", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  if (checking || !group) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <BackLink label={t.summaries.listTitle} href="/settings/summaries" className="mb-2" />
          <h1 className="text-screen-title">{t.summaries.telegramClientsLabel}</h1>
          <p className="mb-4 text-caption-airbnb">{t.summaries.publicGroupSub}</p>

          <StaggerList className="flex flex-col gap-3">
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                      <Send className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-body-airbnb font-medium">
                        {group.connected ? `«${group.chatTitle}»` : t.summaries.telegramNotConnected}
                      </div>
                    </div>
                  </div>
                  {/* Тумблер независим от подключения — тот же принцип, что
                      и на списке каналов. */}
                  <Switch checked={group.enabled} onCheckedChange={(v) => patch({ enabled: v })} className="shrink-0" />
                </div>
                {/* "изменить" — обычная белая кнопка с иконкой (запрос
                    пользователя 2026-07-25: "должна быть нашей типичной
                    белой кнопкой + иконка"), не текстовая ссылка — на своей
                    строке под названием чата. Не подключена — крупная кнопка
                    вместо неё (запрос пользователя 2026-07-24: "нет
                    удобного bottom sheet для подключения"). */}
                {group.connected ? (
                  <PressableScale className="w-fit">
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setConnectOpen(true)}>
                      <Pencil className="size-3.5" />
                      {t.summaries.telegramChangeLink}
                    </Button>
                  </PressableScale>
                ) : (
                  <PressableScale>
                    <Button type="button" className="w-full gap-2" onClick={() => setConnectOpen(true)}>
                      <Send className="size-4" />
                      {t.summaries.connectButton}
                    </Button>
                  </PressableScale>
                )}

              </SpringCard>
            </StaggerItem>

            {/* Автоанонс в группу при включении новой зоны/точки/актива
                (запрос пользователя 2026-07-24) — отдельные тумблеры на
                каждую сущность (решение того же дня), настраиваются
                независимо от того, подключена ли группа прямо сейчас. */}
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                <span className="mb-1 text-[0.6875rem] font-bold tracking-[.08em] text-muted-foreground/70 uppercase">
                  {t.summaries.announceCardLabel}
                </span>
                <p className="mb-2 text-caption-airbnb text-muted-foreground">{t.summaries.announceCardSub}</p>

                <div className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                      <Zap className="size-4" />
                    </div>
                    <div className="text-body-airbnb">{t.summaries.announceZonesLabel}</div>
                  </div>
                  <Switch
                    checked={group.announceNewZones}
                    onCheckedChange={(v) => patch({ announceNewZones: v })}
                    className="shrink-0"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                      <MapPin className="size-4" />
                    </div>
                    <div className="text-body-airbnb">{t.summaries.announcePointsLabel}</div>
                  </div>
                  <Switch
                    checked={group.announceNewPoints}
                    onCheckedChange={(v) => patch({ announceNewPoints: v })}
                    className="shrink-0"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                      <Package className="size-4" />
                    </div>
                    <div className="text-body-airbnb">{t.summaries.announceAssetsLabel}</div>
                  </div>
                  <Switch
                    checked={group.announceNewAssets}
                    onCheckedChange={(v) => patch({ announceNewAssets: v })}
                    className="shrink-0"
                  />
                </div>
              </SpringCard>
            </StaggerItem>
          </StaggerList>
        </div>
      </div>

      <TelegramConnectSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onChanged={loadStatus}
        bindEndpoint="/api/tenant/public-group/telegram/bind"
        statusEndpoint="/api/tenant/public-group/telegram/status"
        testEndpoint="/api/tenant/public-group/telegram/test"
        disconnectEndpoint="/api/tenant/public-group/telegram/disconnect"
        doneHint={t.summaries.publicGroupConnectedHint}
      />
    </OwnerShell>
  );
}
