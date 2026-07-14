import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { calcSessions, calcZoneRevenue, type ZoneAccountingMode } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { dispatchZoneSummary } from "@/lib/summary-channels/dispatch";
import { ZONE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { onResultsSubmission } from "@/lib/summary-channels/daily-cash-trigger";

interface ReadingInput {
  assetId: string;
  tariffId: string;
  reading: number;
}

interface ZoneSubmissionInput {
  zoneId: string;
  returnsCount: number;
  cashAmount: number;
  mobileAmount: number;
  readings: ReadingInput[];
}

interface ExpenseInput {
  zoneId: string;
  amount: number;
  comment?: string;
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const body = await request.json();
  const zoneSubmissions: ZoneSubmissionInput[] = body.zoneSubmissions ?? [];
  const expenses: ExpenseInput[] = body.expenses ?? [];

  if (!Array.isArray(zoneSubmissions) || zoneSubmissions.length === 0) {
    return NextResponse.json({ error: "Выберите хотя бы одну зону" }, { status: 400 });
  }

  // Re-derive everything server-side from the DB rather than trusting any
  // client-computed totals — the client only sends raw entered numbers.
  const zoneIds = zoneSubmissions.map((z) => z.zoneId);
  const zones = await prisma.zone.findMany({
    where: { id: { in: zoneIds }, pointId: point.id },
    include: { tariffs: { where: { deletedAt: null } }, assets: { orderBy: { sortOrder: "asc" } } },
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  if (zones.length !== zoneIds.length) {
    return NextResponse.json({ error: "Одна из зон не найдена" }, { status: 400 });
  }

  // "Previous reading" only means anything in "counters" mode (running meter) —
  // "launches" readings are already the finished count for this submission.
  const allAssetIds = zoneSubmissions
    .filter((z) => zoneById.get(z.zoneId)?.accountingMode === "counters")
    .flatMap((z) => z.readings.map((r) => r.assetId));
  const previousReadings = allAssetIds.length
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: allAssetIds } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const previousByKey = new Map<string, number>();
  for (const reading of previousReadings) {
    const key = `${reading.assetId}:${reading.tariffId}`;
    if (!previousByKey.has(key)) previousByKey.set(key, reading.reading);
  }
  const initialByKey = await getInitialReadingsMap(allAssetIds);

  const summary = zoneSubmissions.map((zs) => {
    const zone = zoneById.get(zs.zoneId)!;
    const tariffCalc = zone.tariffs.map((tariff) => {
      const readingsForTariff = zs.readings.filter((r) => r.tariffId === tariff.id);
      const sessions = readingsForTariff.reduce((sum, r) => {
        if (zone.accountingMode === "launches") return sum + r.reading;
        const key = `${r.assetId}:${tariff.id}`;
        const previous = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
        return sum + calcSessions(r.reading, previous);
      }, 0);
      return { tariffId: tariff.id, price: Number(tariff.price), sessions };
    });

    const calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
    const actualCash = zs.cashAmount + zs.mobileAmount;
    const difference = Math.round((actualCash - calculatedRevenue) * 100) / 100;

    const readingsText = zone.assets
      .map((asset) => {
        const values = zs.readings
          .filter((r) => r.assetId === asset.id)
          .map((r) => r.reading)
          .join("/");
        return `${asset.name}: ${values}`;
      })
      .join(", ");

    // Для сводки "по зоне" (docs/spec/telegram-summaries.md, Шаг 3, п.1):
    // "<Актив> · <Тариф>: <показание> (+<дельта>)", полные имена — построчно
    // по каждой введённой паре актив+тариф, не агрегируя.
    const readingLines = zone.assets.flatMap((asset) =>
      zone.tariffs
        .map((tariff) => {
          const reading = zs.readings.find((r) => r.assetId === asset.id && r.tariffId === tariff.id);
          if (!reading) return null;
          const key = `${asset.id}:${tariff.id}`;
          const delta =
            zone.accountingMode === "launches"
              ? reading.reading
              : calcSessions(reading.reading, previousByKey.get(key) ?? initialByKey.get(key) ?? 0);
          return { assetName: asset.name, tariffName: tariff.name, reading: reading.reading, delta };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    );

    return {
      zoneId: zs.zoneId,
      zoneName: zone.name,
      calculatedRevenue,
      actualCash,
      difference,
      readingsText,
      readingLines,
      returnsCount: zs.returnsCount,
      cashAmount: zs.cashAmount,
      mobileAmount: zs.mobileAmount,
    };
  });

  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.resultsSubmission.create({
      data: { tenantId: point.tenantId, pointId: point.id, operatorId: operator.id },
    });

    for (const zs of zoneSubmissions) {
      const zoneSubmission = await tx.zoneSubmission.create({
        data: {
          resultsSubmissionId: created.id,
          zoneId: zs.zoneId,
          returnsCount: zs.returnsCount,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
        },
      });

      for (const reading of zs.readings) {
        await tx.assetReading.create({
          data: {
            zoneSubmissionId: zoneSubmission.id,
            assetId: reading.assetId,
            tariffId: reading.tariffId,
            reading: reading.reading,
          },
        });
      }

      const zoneExpenses = expenses.filter((e) => e.zoneId === zs.zoneId);
      for (const expense of zoneExpenses) {
        await tx.expenseEntry.create({
          data: {
            zoneSubmissionId: zoneSubmission.id,
            amount: expense.amount,
            comment: expense.comment || null,
          },
        });
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: zs.zoneId,
            type: "expense",
            amount: -Math.abs(expense.amount),
            performedByOperatorId: operator.id,
            comment: expense.comment || null,
            resultsSubmissionId: created.id,
          },
        });
      }

      if (zs.cashAmount > 0) {
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: zs.zoneId,
            type: "revenue",
            amount: zs.cashAmount,
            performedByOperatorId: operator.id,
            resultsSubmissionId: created.id,
          },
        });
      }
      // Безнал — тоже выручка, "учётно, без наличного остатка" (docs/spec/02-money.md) —
      // отдельный тип, а не "revenue", чтобы отчёты Денег могли посчитать его
      // в "Выручка"/"Прибыль" бизнеса, но НЕ добавлять в остаток физической
      // кассы зоны ("сколько наличных должно быть на точке" — только про
      // реальные бумажные деньги). Найдено аудитом 2026-07-12: раньше безнал
      // нигде не журналировался, "Выручка" в Деньгах занижалась на его сумму.
      if (zs.mobileAmount > 0) {
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: zs.zoneId,
            type: "revenue_cashless",
            amount: zs.mobileAmount,
            performedByOperatorId: operator.id,
            resultsSubmissionId: created.id,
          },
        });
      }
    }

    return created;
  });

  // "Сводка по зоне" (docs/spec/telegram-summaries.md) — одна сводка на каждую
  // выбранную зону, не одно сообщение на всю сдачу (замена старой единой
  // Telegram-сводки submit-results — см. Шаг 0, решение о платформенном боте).
  const zoneSummarySettings =
    (await prisma.zoneSummarySettings.findUnique({ where: { tenantId: point.tenantId } })) ?? ZONE_SUMMARY_DEFAULTS;
  if (zoneSummarySettings.enabled) {
    for (const s of summary) {
      const zone = zoneById.get(s.zoneId)!;
      dispatchZoneSummary(
        point.tenantId,
        {
          pointName: point.name,
          zoneName: s.zoneName,
          zoneEmoji: zone.telegramEmoji,
          accountingMode: zone.accountingMode as ZoneAccountingMode,
          occurredAt: submission.submittedAt,
          readings: s.readingLines,
          cashAmount: s.cashAmount,
          mobileAmount: s.mobileAmount,
          calculatedRevenue: s.calculatedRevenue,
          difference: s.difference,
          returnsCount: s.returnsCount,
          operatorName: operator.name,
          operatorColorTag: operator.colorTag,
        },
        zoneSummarySettings
      ).catch((err) => console.error("zone summary dispatch failed", err));
    }
  }

  // "Касса за день": в режиме event — отправить сразу, как только все активные
  // зоны точки отчитались за сегодня; если сводка уже уходила — досдача
  // (пересчитать и обновить/переслать). См. daily-cash-trigger.ts.
  onResultsSubmission(point.id, point.tenantId, submission.submittedAt).catch((err) =>
    console.error("daily cash trigger failed", err)
  );

  // Мягкое напоминание (docs/spec/05-work-time.md, "СВЯЗЬ СО СДАЧЕЙ ИТОГОВ") —
  // после сдачи итогов, если сегодня ещё не отмечен уход (нет смены с
  // startAt сегодня — сама смена вводится целиком, "уход" не отдельное
  // событие, поэтому это буквально "смена сегодня ещё не введена").
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const todayShift = await prisma.shift.findFirst({
    where: { operatorId: operator.id, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const remindMarkDeparture = !todayShift;

  return NextResponse.json({ id: submission.id, summary, remindMarkDeparture });
}
