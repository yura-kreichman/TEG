"use client";

import Link from "next/link";
import { ChevronRight, Clock, Languages, Palette, Send, Trash2 } from "lucide-react";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PlanCard } from "@/components/plan-card";
import { useI18n } from "@/components/i18n-provider";

export default function SettingsPage() {
  const t = useI18n();

  const items = [
    {
      href: "/settings/appearance",
      icon: Palette,
      title: t.settings.appearanceTitle,
      sub: t.settings.appearanceHint,
    },
    {
      href: "/settings/language",
      icon: Languages,
      title: t.settings.languageTitle,
      sub: t.settings.languageHint,
    },
    {
      href: "/settings/summaries",
      icon: Send,
      title: t.summaries.listTitle,
      sub: t.summaries.listSubtitle,
    },
    {
      href: "/settings/work-time",
      icon: Clock,
      title: t.settings.workTimeTitle,
      sub: t.settings.workTimeHint,
    },
    {
      href: "/settings/data-cleanup",
      icon: Trash2,
      title: t.dataCleanup.title,
      sub: t.dataCleanup.hint,
    },
  ];

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-6">
          <h1 className="text-screen-title">{t.settings.title}</h1>

          <StaggerList className="flex flex-col gap-3">
            {items.map((item) => (
              <StaggerItem key={item.href}>
                <Link href={item.href}>
                  <SpringCard animate={false} className="flex cursor-pointer items-center gap-3.5">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <item.icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-body-airbnb font-bold">{item.title}</div>
                      <div className="truncate text-caption-airbnb">{item.sub}</div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </SpringCard>
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>

          <PlanCard />
        </div>
      </div>
    </OwnerShell>
  );
}
