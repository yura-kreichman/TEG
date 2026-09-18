"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ChevronRight, Circle, EyeOff } from "lucide-react";
import { SpringCard } from "@/components/spring-card";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { useI18n } from "@/components/i18n-provider";
import type { SetupProgress, SetupStep } from "@/lib/onboarding/setup-progress";
import { cn } from "@/lib/utils";

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");
}

/**
 * «Первые шаги» на главной (docs/spec/13-onboarding.md). Прогресс, а не
 * предупреждение: зелёная галочка у пройденного, пустой кружок у остального —
 * без жёлтых плашек и значков тревоги. Строка ведёт на экран, где шаг
 * делается; действий внутри карточки нет, включение точек и зон — как и
 * везде, через «···» на их экранах.
 */
export function SetupChecklistCard({ progress }: { progress: SetupProgress }) {
  const t = useI18n();
  const o = t.onboarding;
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (hidden) return null;

  async function hide() {
    setMenuOpen(false);
    setHidden(true);
    await fetch("/api/tenant/onboarding/hide-checklist", { method: "POST" }).catch(() => {});
  }

  // Названия пунктов меню и разделов в подсказках — из тех же ключей, что и
  // само меню: иначе на каком-нибудь из 15 языков подсказка звала бы нажать
  // пункт, которого на экране нет.
  const hintContext: Record<string, string> = {
    activatePointMenu: t.points.activatePoint,
    activateZoneMenu: t.zoneDetail.activateZone,
    activateAssetMenu: t.zoneDetail.activateAsset,
    pointsSection: t.nav.points,
    addDeviceMenu: t.points.addDeviceButton,
  };

  const titles: Record<SetupStep["key"], string> = {
    point: o.stepPoint,
    zone: o.stepZone,
    zoneOn: o.stepZoneOn,
    operator: o.stepOperator,
    device: o.stepDevice,
    firstWork: o.stepFirstWork,
  };

  return (
    <SpringCard hover={false} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-section-title grow">{o.checklistTitle}</h2>
        <span className="text-caption-airbnb tabular-nums">
          {fill(o.checklistCounter, { done: String(progress.doneCount), total: String(progress.total) })}
        </span>
        <KebabButton onClick={() => setMenuOpen(true)} label={o.checklistActionsLabel} />
      </div>

      <div className="flex flex-col gap-1">
        {progress.steps.map((step) => (
          <ChecklistRow
            key={step.key}
            done={step.done}
            title={titles[step.key]}
            hint={step.hint ? fill(o.hints[step.hint.key], { ...hintContext, ...step.hint.params }) : null}
            href={step.done ? null : step.href}
          />
        ))}
      </div>

      <div className="border-t border-border pt-2">
        <ChecklistRow
          done={progress.landingPublished}
          title={o.stepLanding}
          hint={progress.landingPublished ? null : o.hints.publishLanding}
          href={progress.landingPublished ? null : "/settings/landing"}
        />
      </div>

      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="pt-2">
          <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">{o.checklistTitle}</h2>
          <ActionSheetItem icon={EyeOff} onClick={hide}>
            {o.hideChecklist}
          </ActionSheetItem>
        </div>
      </BottomSheet>
    </SpringCard>
  );
}

function ChecklistRow({ done, title, hint, href }: { done: boolean; title: string; hint: string | null; href: string | null }) {
  const body = (
    <div className="flex items-start gap-2.5 py-1.5">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-primary" />
      ) : (
        <Circle className="mt-0.5 size-4.5 shrink-0 text-muted-foreground/60" />
      )}
      <div className="min-w-0 grow">
        <p className={cn("text-body-airbnb", done && "text-muted-foreground")}>{title}</p>
        {hint && <p className="text-caption-airbnb text-muted-foreground">{hint}</p>}
      </div>
      {href && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} className="-mx-1.5 rounded-control px-1.5 transition-colors hover:bg-muted active:bg-muted">
      {body}
    </Link>
  );
}
