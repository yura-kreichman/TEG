import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireOwner } from "@/lib/require-owner";
import { isZoneSubmissionEditable } from "@/lib/results-submission";
import { calcSessions, calcZoneGrossRevenue, calcZoneRevenue } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { getZoneAbonementSpendAmount } from "@/lib/abonement";
import { editChatMessage } from "@/lib/telegram-bot";
import { formatZoneSummaryTelegram } from "@/lib/summary-channels/telegram-format";
import { ZONE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { isLocale, type Locale } from "@/lib/locales";
import { getDictionary } from "@/lib/i18n";

interface CorrectionDiff {
  cashAmount: number;
  mobileAmount: number;
  returnsCount: number;
  readings: Record<string, number>;
}

async function loadZoneSubmission(id: string, tenantId: string) {
  const zoneSubmission = await prisma.zoneSubmission.findUnique({
    where: { id },
    include: {
      zone: { include: { point: true, tariffs: { where: { deletedAt: null } }, assets: { orderBy: { sortOrder: "asc" } } } },
      assetReadings: true,
      resultsSubmission: true,
    },
  });
  if (!zoneSubmission || zoneSubmission.zone.point.tenantId !== tenantId) return null;
  return zoneSubmission;
}

// Пересчитывает и редактирует уже отправленную Telegram-сводку по зоне после
// правки кассы/показаний (запрос пользователя 2026-07-25: "на будущее сделай
// сохранение id... чтобы такие ситуации можно было чинить") — только
// counters/cash_only (остальные режимы через этот роут вообще не
// редактируются, см. isZoneSubmissionEditable). Best-effort — падение здесь
// не должно ронять саму правку, которая к этому моменту уже сохранена.
async function reEditZoneSummaryMessage(zoneSubmissionId: string, tenantId: string): Promise<void> {
  const zs = await prisma.zoneSubmission.findUnique({
    where: { id: zoneSubmissionId },
    include: {
      zone: { include: { tariffs: { where: { deletedAt: null } }, assets: { orderBy: { sortOrder: "asc" } } } },
      assetReadings: true,
      resultsSubmission: { include: { operator: { select: { name: true, colorTag: true } } } },
    },
  });
  if (!zs?.telegramSummaryMessageId) return;

  const [channel, zoneSummarySettings, point, tenant] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
    }),
    prisma.zoneSummarySettings.findUnique({ where: { tenantId } }),
    prisma.point.findFirst({ where: { zones: { some: { id: zs.zoneId } } } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, locale: true, timezone: true } }),
  ]);
  if (!channel?.chatId || !point) return;

  const settings = zoneSummarySettings ?? ZONE_SUMMARY_DEFAULTS;
  if (!settings.enabled) return;

  const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  const timezone = tenant?.timezone ?? "UTC";
  const st = getDictionary(locale).summaryText;

  // Предыдущая сдача ЭТОЙ ЖЕ зоны, СТРОГО до текущей (previousSubmissionBoundary
  // из game-room.ts берёт "последнюю", а здесь текущая сдача сама и есть
  // последняя — нужна именно предыдущая, отсюда отдельный запрос).
  const previous = await prisma.zoneSubmission.findFirst({
    where: { zoneId: zs.zoneId, createdAt: { lt: zs.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const boundary = previous?.createdAt ?? null;

  const isCashOnly = zs.zone.accountingMode === "cash_only";
  let calculatedRevenue = 0;
  let netRevenue = 0;
  let readingLines: { assetName: string; tariffName: string; reading: number; delta: number }[] = [];

  if (!isCashOnly) {
    const previousReadings = await prisma.assetReading.findMany({
      where: { assetId: { in: zs.zone.assets.map((a) => a.id) }, zoneSubmissionId: { not: zs.id } },
      orderBy: { createdAt: "desc" },
    });
    const previousByKey = new Map<string, number>();
    for (const r of previousReadings) {
      const key = `${r.assetId}:${r.tariffId}`;
      if (!previousByKey.has(key)) previousByKey.set(key, r.reading);
    }
    const initialByKey = await getInitialReadingsMap(zs.zone.assets.map((a) => a.id));

    const tariffCalc = zs.zone.tariffs.map((tariff) => {
      const readingsForTariff = zs.assetReadings.filter((r) => r.tariffId === tariff.id);
      const sessions = readingsForTariff.reduce((sum, r) => {
        const key = `${r.assetId}:${tariff.id}`;
        const previousReading = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
        return sum + calcSessions(r.reading, previousReading);
      }, 0);
      return { tariffId: tariff.id, price: Number(tariff.price), sessions };
    });
    calculatedRevenue = calcZoneGrossRevenue(tariffCalc);
    netRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);

    readingLines = zs.zone.assets.flatMap((asset) =>
      zs.zone.tariffs
        .map((tariff) => {
          const reading = zs.assetReadings.find((r) => r.assetId === asset.id && r.tariffId === tariff.id);
          if (!reading) return null;
          const key = `${asset.id}:${tariff.id}`;
          const previousReading = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
          return { assetName: asset.name, tariffName: tariff.name, reading: reading.reading, delta: calcSessions(reading.reading, previousReading) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    );
  }

  // Баланс — только информационная строка у "Счётчиков"/"Только касса"
  // (запрос пользователя 2026-07-25, финальное решение) — в саму Разницу
  // не подмешивается, эта функция обслуживает только эти два режима (см.
  // isZoneSubmissionEditable в вызывающем коде).
  const abonementAmount = await getZoneAbonementSpendAmount(zs.zoneId, boundary);
  const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
  const difference = isCashOnly ? 0 : Math.round((actualCash - netRevenue) * 100) / 100;

  const text = formatZoneSummaryTelegram(
    {
      pointName: point.name,
      zoneName: zs.zone.name,
      zoneEmoji: zs.zone.telegramEmoji,
      accountingMode: zs.zone.accountingMode as import("@/lib/results-calc").ZoneAccountingMode,
      isGameRoom: false,
      gameRoomLaunchCount: null,
      gameRoomTotalMinutes: null,
      occurredAt: zs.createdAt,
      readings: readingLines,
      perAsset: [],
      ticketsOrdersCount: null,
      ticketsCount: null,
      cashAmount: Number(zs.cashAmount),
      mobileAmount: Number(zs.mobileAmount),
      abonementAmount,
      calculatedRevenue,
      difference,
      returnsCount: zs.returnsCount,
      operatorName: zs.resultsSubmission.operator.name,
      operatorColorTag: zs.resultsSubmission.operator.colorTag,
    },
    settings,
    locale,
    timezone,
    st
  );
  await editChatMessage(channel.chatId, zs.telegramSummaryMessageId, text).catch(() => {});
}

// Правка последней сдачи по зоне (docs/spec/01-counters.md, «Прозрачность»):
// показания по тарифам, касса/моб./возвраты — с необязательной причиной,
// журналируется в CorrectionLog, привязанная MoneyOperation (revenue) держится
// в синхроне с новой суммой наличных.
export async function PATCH(request: Request, ctx: RouteContext<"/api/reports/counters/zone-submission/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zoneSubmission = await loadZoneSubmission(id, owner.tenantId);
  if (!zoneSubmission) {
    return NextResponse.json({ error: "Сдача не найдена" }, { status: 404 });
  }

  if (!(await isZoneSubmissionEditable(id, zoneSubmission.zone.accountingMode))) {
    // Для counters причина — незакрытая цепочка показаний; для остальных
    // не-cash_only режимов правка/удаление недоступны структурно (см.
    // комментарий у isZoneSubmissionEditable) — разные причины требуют
    // разного сообщения, иначе владелец решит подождать несуществующую
    // "более позднюю сдачу".
    const error =
      zoneSubmission.zone.accountingMode === "counters"
        ? "Есть более поздняя сдача по одному из активов этой зоны — сначала удалите её."
        : "Сдачи этого режима учёта нельзя редактировать или удалять.";
    return NextResponse.json({ error }, { status: 409 });
  }

  const body = await request.json();
  const { readings, cashAmount, mobileAmount, returnsCount, reason } = body as {
    readings?: Record<string, number>;
    cashAmount?: number;
    mobileAmount?: number;
    returnsCount?: number;
    reason?: string;
  };

  const before: CorrectionDiff = {
    cashAmount: Number(zoneSubmission.cashAmount),
    mobileAmount: Number(zoneSubmission.mobileAmount),
    returnsCount: zoneSubmission.returnsCount,
    readings: Object.fromEntries(
      zoneSubmission.assetReadings.map((r) => [`${r.assetId}:${r.tariffId}`, r.reading])
    ),
  };

  const nextCash = cashAmount !== undefined ? Number(cashAmount) : before.cashAmount;
  const nextMobile = mobileAmount !== undefined ? Number(mobileAmount) : before.mobileAmount;
  const nextReturns = returnsCount !== undefined ? Number(returnsCount) : before.returnsCount;
  if (![nextCash, nextMobile, nextReturns].every((n) => Number.isFinite(n) && n >= 0)) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const nextReadings = { ...before.readings };
  if (readings) {
    const validKeys = new Set(zoneSubmission.assetReadings.map((r) => `${r.assetId}:${r.tariffId}`));
    for (const [key, value] of Object.entries(readings)) {
      if (!validKeys.has(key)) {
        return NextResponse.json({ error: "Некорректный актив/тариф" }, { status: 400 });
      }
      if (!Number.isInteger(value) || value < 0 || value > 9999) {
        return NextResponse.json({ error: "Показание должно быть числом 0–9999" }, { status: 400 });
      }
      nextReadings[key] = value;
    }
  }

  const after: CorrectionDiff = {
    cashAmount: nextCash,
    mobileAmount: nextMobile,
    returnsCount: nextReturns,
    readings: nextReadings,
  };

  await prisma.$transaction(async (tx) => {
    for (const r of zoneSubmission.assetReadings) {
      const key = `${r.assetId}:${r.tariffId}`;
      if (nextReadings[key] !== r.reading) {
        await tx.assetReading.update({ where: { id: r.id }, data: { reading: nextReadings[key] } });
      }
    }

    await tx.zoneSubmission.update({
      where: { id },
      data: { cashAmount: nextCash, mobileAmount: nextMobile, returnsCount: nextReturns },
    });

    const revenueOp = await tx.moneyOperation.findFirst({
      where: {
        resultsSubmissionId: zoneSubmission.resultsSubmissionId,
        zoneId: zoneSubmission.zoneId,
        type: "revenue",
      },
    });
    if (nextCash > 0) {
      if (revenueOp) {
        await tx.moneyOperation.update({ where: { id: revenueOp.id }, data: { amount: nextCash } });
      } else {
        await tx.moneyOperation.create({
          data: {
            tenantId: owner.tenantId,
            zoneId: zoneSubmission.zoneId,
            type: "revenue",
            amount: nextCash,
            performedByUserId: owner.user.id,
            resultsSubmissionId: zoneSubmission.resultsSubmissionId,
          },
        });
      }
    } else if (revenueOp) {
      await tx.moneyOperation.delete({ where: { id: revenueOp.id } });
    }

    // Безнал — та же логика, отдельный тип revenue_cashless (см. submit-results/route.ts).
    const revenueCashlessOp = await tx.moneyOperation.findFirst({
      where: {
        resultsSubmissionId: zoneSubmission.resultsSubmissionId,
        zoneId: zoneSubmission.zoneId,
        type: "revenue_cashless",
      },
    });
    if (nextMobile > 0) {
      if (revenueCashlessOp) {
        await tx.moneyOperation.update({ where: { id: revenueCashlessOp.id }, data: { amount: nextMobile } });
      } else {
        await tx.moneyOperation.create({
          data: {
            tenantId: owner.tenantId,
            zoneId: zoneSubmission.zoneId,
            type: "revenue_cashless",
            amount: nextMobile,
            performedByUserId: owner.user.id,
            resultsSubmissionId: zoneSubmission.resultsSubmissionId,
          },
        });
      }
    } else if (revenueCashlessOp) {
      await tx.moneyOperation.delete({ where: { id: revenueCashlessOp.id } });
    }

    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (changed) {
      await tx.correctionLog.create({
        data: {
          entityType: "ZoneSubmission",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: JSON.parse(JSON.stringify(before)),
          afterJson: JSON.parse(JSON.stringify(after)),
          comment: typeof reason === "string" && reason.trim() ? reason.trim() : null,
        },
      });
    }
  });

  // Best-effort, вне транзакции (сетевой вызов) — правка кассы уже сохранена
  // независимо от того, получится ли обновить Telegram (запрос пользователя
  // 2026-07-25).
  await reEditZoneSummaryMessage(id, owner.tenantId).catch(() => {});

  return NextResponse.json({ ok: true });
}

// Удаление последней сдачи по зоне — необратимо, попадает в CorrectionLog как
// снимок «до» без «после». MoneyOperation-и (revenue/expense), созданные этой
// сдачей, удаляются вместе с ней, чтобы не оставлять денежный след без записи.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/reports/counters/zone-submission/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zoneSubmission = await loadZoneSubmission(id, owner.tenantId);
  if (!zoneSubmission) {
    return NextResponse.json({ error: "Сдача не найдена" }, { status: 404 });
  }

  if (!(await isZoneSubmissionEditable(id, zoneSubmission.zone.accountingMode))) {
    // Для counters причина — незакрытая цепочка показаний; для остальных
    // не-cash_only режимов правка/удаление недоступны структурно (см.
    // комментарий у isZoneSubmissionEditable) — разные причины требуют
    // разного сообщения, иначе владелец решит подождать несуществующую
    // "более позднюю сдачу".
    const error =
      zoneSubmission.zone.accountingMode === "counters"
        ? "Есть более поздняя сдача по одному из активов этой зоны — сначала удалите её."
        : "Сдачи этого режима учёта нельзя редактировать или удалять.";
    return NextResponse.json({ error }, { status: 409 });
  }

  const before: CorrectionDiff = {
    cashAmount: Number(zoneSubmission.cashAmount),
    mobileAmount: Number(zoneSubmission.mobileAmount),
    returnsCount: zoneSubmission.returnsCount,
    readings: Object.fromEntries(
      zoneSubmission.assetReadings.map((r) => [`${r.assetId}:${r.tariffId}`, r.reading])
    ),
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.moneyOperation.deleteMany({
        where: { resultsSubmissionId: zoneSubmission.resultsSubmissionId, zoneId: zoneSubmission.zoneId },
      });

      await tx.correctionLog.create({
        data: {
          entityType: "ZoneSubmission",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: JSON.parse(JSON.stringify(before)),
          afterJson: { deleted: true },
          comment: null,
        },
      });

      await tx.zoneSubmission.delete({ where: { id } });

      const remaining = await tx.zoneSubmission.count({
        where: { resultsSubmissionId: zoneSubmission.resultsSubmissionId },
      });
      if (remaining === 0) {
        await tx.resultsSubmission.delete({ where: { id: zoneSubmission.resultsSubmissionId } });
      }
    });
  } catch (err) {
    // Гонка двойного клика/повторного запроса — эту сдачу уже удалил первый
    // запрос (P2025 "record not found"). Транзакция атомарна, поэтому ничего
    // не осталось наполовину применённым: для DELETE это идемпотентно, не ошибка.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ ok: true });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
