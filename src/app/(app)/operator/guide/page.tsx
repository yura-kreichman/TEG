"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { SpringCard } from "@/components/spring-card";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import type { OperatorGuideData } from "@/lib/operator-guide";

/**
 * «Как работать» — памятка, собранная под конкретного сотрудника (решение
 * владельца 2026-08-16). Ни подписи, ни версий, ни возможности удалить: это
 * не инструктаж, а справка, которая всегда соответствует текущим настройкам.
 *
 * Состав блоков приходит с сервера (lib/operator-guide.ts), тексты берутся
 * из словаря здесь — чтобы перевод не ездил по сети на каждый запрос.
 * Показываем только то, с чем этот человек реально встретится: у сотрудника
 * без товаров не должно быть ни слова про склад.
 */
export default function OperatorGuidePage() {
  const t = useI18n();
  const g = t.operatorGuide;
  const router = useRouter();
  const [data, setData] = useState<OperatorGuideData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/operator/guide")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/operator/login");
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((json) => setData(json))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 md:max-w-xl lg:max-w-2xl">
          <Skeleton className="mb-2 h-7 w-40" />
          <SkeletonListRows count={5} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const b = data.blocks;
  const modeLabel: Record<OperatorGuideData["zones"][number]["mode"], string> = {
    counters: g.modeCounters,
    countersTap: g.modeCountersTap,
    staysEntry: g.modeStaysEntry,
    staysTime: g.modeStaysTime,
    launches: g.modeLaunches,
    launchesTimer: g.modeLaunchesTimer,
    tickets: g.modeTickets,
    cashOnly: g.modeCashOnly,
  };

  // Блок = заголовок + абзацы; пустые (все условия внутри ложны) не
  // рендерятся вовсе — иначе остался бы заголовок без содержимого.
  const sections: { title: string; paragraphs: string[]; notes?: string[] }[] = [];
  const push = (title: string, paragraphs: (string | false | null | undefined)[], notes?: (string | false | null | undefined)[]) => {
    const body = paragraphs.filter((p): p is string => Boolean(p));
    const noteList = (notes ?? []).filter((p): p is string => Boolean(p));
    if (body.length === 0 && noteList.length === 0) return;
    sections.push({ title, paragraphs: body, notes: noteList });
  };

  if (b.counters) push(g.countersTitle, [g.countersText]);
  if (b.countersTap) push(g.countersTapTitle, [g.countersTapText]);
  if (b.returns) push(g.returnsTitle, [g.returnsText]);
  if (b.stays) push(g.staysTitle, [g.staysText, b.staysRounding && g.staysRoundingText]);
  if (b.launches) push(g.launchesTitle, [g.launchesText, b.launchesTimer && g.launchesTimerText]);
  if (b.tickets) {
    push(g.ticketsTitle, [g.ticketsText, b.ticketsRedemption && g.ticketsRedemptionText]);
    push(g.ticketsLockTitle, [g.ticketsLockText]);
  }
  if (b.abonements) push(g.abonementsTitle, [g.abonementsText, b.balanceSpendCounters && g.balanceSpendCountersText]);
  if (b.payments)
    push(
      g.paymentsTitle,
      [g.paymentsText, b.balance && g.paymentsBalanceText, g.paymentsSplitText],
      [b.balance && g.balanceNote]
    );
  if (b.goods)
    push(g.goodsTitle, [
      g.goodsText,
      g.goodsHeldText,
      b.goodsBalance && g.goodsBalanceText,
      b.goodsRevision ? g.goodsRevisionText : g.goodsNoRevisionText,
      g.goodsCashText,
    ]);
  if (b.expenses) push(g.expensesTitle, [g.expensesText, g.expensesDeleteText], [g.expensesCommentText]);
  push(
    g.submitTitle,
    [g.submitCashText, b.submitByAsset && g.submitByAssetText, b.showDifference && g.submitDifferenceText],
    [b.expenses && g.submitExpensesText]
  );
  if (b.print) push(g.printTitle, [g.printText]);
  push(g.collectionTitle, [g.collectionText]);
  if (b.payout) push(g.payoutTitle, [b.payout === "accrual" ? g.payoutAccrualText : g.payoutCashText]);
  if (b.tasks) push(g.tasksTitle, [g.tasksText]);
  push(g.mistakeTitle, [g.mistakeText]);
  push(g.offlineTitle, [g.offlineText]);

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 md:max-w-xl lg:max-w-2xl">
        <BackLink label={t.common.back} href="/operator" />

        <div>
          <h1 className="text-[1.5rem] font-extrabold tracking-[-0.02em]">
            {g.greeting.replace("{name}", data.operatorName)}
          </h1>
          <p className="mt-1 text-body-airbnb text-muted-foreground">{g.intro}</p>
        </div>

        {/* Рабочее время — «ярлык: значение»: вариативность в коротком
            хвосте, а не в отдельном абзаце на каждый режим. */}
        <SpringCard hover={false} animate={false} className="flex flex-col gap-1.5">
          <p className="text-body-airbnb">
            <span className="font-bold">{g.timeLabel}:</span>{" "}
            {data.timeTracking === "auto" ? g.timeAuto : g.timeManual}
          </p>
          <p className="border-l-2 border-border pl-3 text-caption-airbnb text-muted-foreground">{g.timeNote}</p>
        </SpringCard>

        {data.zones.length > 0 && (
          <SpringCard hover={false} animate={false} className="flex flex-col gap-2">
            <p className="text-body-airbnb font-bold">{g.zonesLabel}</p>
            <div className="flex flex-col gap-1.5">
              {data.zones.map((zone) => (
                <div key={zone.id} className="flex items-center gap-2">
                  <AssetOrZoneIcon iconKey={zone.iconKey} className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body-airbnb font-semibold">{zone.name}</span>
                  <span className="shrink-0 text-caption-airbnb text-muted-foreground">{modeLabel[zone.mode]}</span>
                </div>
              ))}
            </div>
          </SpringCard>
        )}

        <StaggerList className="flex flex-col gap-3">
          {sections.map((section) => (
            <StaggerItem key={section.title}>
              <SpringCard hover={false} animate={false} className="flex flex-col gap-2">
                <p className="text-body-airbnb font-bold">{section.title}</p>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-body-airbnb text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
                {/* Заметки — цитатой: это предупреждения «почему так», а не
                    шаги. Визуально отделены, чтобы их не пролистывали
                    вместе с описанием действий. */}
                {section.notes?.map((note) => (
                  <p key={note} className="border-l-2 border-primary/40 pl-3 text-caption-airbnb text-foreground">
                    {note}
                  </p>
                ))}
              </SpringCard>
            </StaggerItem>
          ))}
        </StaggerList>
      </div>
    </div>
  );
}
