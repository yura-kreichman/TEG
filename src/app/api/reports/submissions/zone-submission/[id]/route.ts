import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireOwner } from "@/lib/require-owner";
import { getZoneSubmissionEditability } from "@/lib/results-submission";
import { reverseResultsSubmissionAdvanceSettlement } from "@/lib/zone-balance";
import { resyncDailyCashForZone } from "@/lib/summary-channels/resync";
import { resyncZoneSummaryMessage } from "@/lib/summary-channels/zone-summary-message";

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

// Правка последней сдачи по зоне (docs/spec/01-counters.md, «Прозрачность»):
// показания по тарифам, касса/моб./возвраты — с необязательной причиной,
// журналируется в CorrectionLog, привязанная MoneyOperation (revenue) держится
// в синхроне с новой суммой наличных.
export async function PATCH(request: Request, ctx: RouteContext<"/api/reports/submissions/zone-submission/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zoneSubmission = await loadZoneSubmission(id, owner.tenantId);
  if (!zoneSubmission) {
    return NextResponse.json({ error: "Сдача не найдена" }, { status: 404 });
  }

  const editability = await getZoneSubmissionEditability(id, zoneSubmission.zone.accountingMode);
  if (!editability.canEditCash) {
    // Сюда доходит только counters с незакрытой цепочкой показаний: у
    // остальных режимов касса правится всегда (см. getZoneSubmissionEditability).
    return NextResponse.json(
      { error: "Есть более поздняя сдача по одному из активов этой зоны — сначала удалите её." },
      { status: 409 }
    );
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

  // «Живые» зоны (stays/launches-тап/tickets): показаний у них нет, возвраты
  // неприменимы — правится только касса. Сверяем по фактическому изменению, а
  // не по наличию полей в теле: форма шлёт свой драфт целиком, и отказывать
  // на неизменившемся значении значило бы ломать штатную правку кассы.
  if (!editability.canEditReadings) {
    const readingsChanged = Object.entries(nextReadings).some(([key, value]) => before.readings[key] !== value);
    if (readingsChanged || nextReturns !== before.returnsCount) {
      return NextResponse.json({ error: "В этом режиме учёта правится только касса." }, { status: 400 });
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
      // Откатываем автопогашение "Аванса инкассации", если оно было
      // привязано к этой сдаче — см. reverseResultsSubmissionAdvanceSettlement
      // (аудит 2026-07-27, реальный денежный баг: правка кассы задним числом
      // не пересчитывала уже проведённое автопогашение, аванс считался
      // погашенным даже когда выручка, которой его погасили, уже не та).
      // Безопасно вызывать даже когда settlement не было — deleteMany по
      // несуществующим строкам просто ничего не делает.
      await reverseResultsSubmissionAdvanceSettlement(tx, zoneSubmission.resultsSubmissionId);
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
  await resyncZoneSummaryMessage(id, owner.tenantId).catch(() => {});
  // И "Касса за день" точки — она суммирует кассу всех зон, правка сдачи её
  // меняет (требование владельца 2026-08-16).
  await resyncDailyCashForZone(zoneSubmission.zoneId, owner.tenantId, zoneSubmission.createdAt);

  return NextResponse.json({ ok: true });
}

// Удаление последней сдачи по зоне — необратимо, попадает в CorrectionLog как
// снимок «до» без «после». MoneyOperation-и (revenue/expense), созданные этой
// сдачей, удаляются вместе с ней, чтобы не оставлять денежный след без записи.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/reports/submissions/zone-submission/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zoneSubmission = await loadZoneSubmission(id, owner.tenantId);
  if (!zoneSubmission) {
    return NextResponse.json({ error: "Сдача не найдена" }, { status: 404 });
  }

  if (!(await getZoneSubmissionEditability(id, zoneSubmission.zone.accountingMode)).canDelete) {
    // Причины разные, и владельцу их нельзя путать: у counters надо дождаться
    // (удалить более позднюю сдачу), у живых зон ждать нечего — удаление там
    // задваивает выручку и закрыто навсегда (см. getZoneSubmissionEditability).
    const error =
      zoneSubmission.zone.accountingMode === "counters"
        ? "Есть более поздняя сдача по одному из активов этой зоны — сначала удалите её."
        : "Сдачи этого режима учёта нельзя удалять — можно поправить кассу.";
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

  // Сообщение в чате переписываем ДО удаления: после него собирать текст уже
  // не из чего, а удалить сообщение Telegram не даст — старше 48 часов оно не
  // удаляется (правка владельца 2026-08-16: раньше в чате навсегда оставались
  // цифры удалённой сдачи).
  await resyncZoneSummaryMessage(id, owner.tenantId, { voided: true }).catch(() => {});

  try {
    await prisma.$transaction(async (tx) => {
      // Расходы удаление сдачи НЕ уносит, а отвязывает (2026-08-15): сдача их
      // больше не создаёт — Сотрудник внёс их сам, ещё до неё, и деньги из
      // кассы вынуты по-настоящему. Удалять их вместе со сдачей значило бы
      // стирать чужие траты за компанию; отвязанные, они возвращаются в
      // "текущий период" зоны и войдут в следующую сдачу.
      await tx.moneyOperation.updateMany({
        where: {
          resultsSubmissionId: zoneSubmission.resultsSubmissionId,
          zoneId: zoneSubmission.zoneId,
          type: "expense",
        },
        data: { resultsSubmissionId: null },
      });
      await tx.moneyOperation.deleteMany({
        where: { resultsSubmissionId: zoneSubmission.resultsSubmissionId, zoneId: zoneSubmission.zoneId },
      });

      // Тот же откат автопогашения аванса, что и в PATCH выше — см.
      // reverseResultsSubmissionAdvanceSettlement (аудит 2026-07-27).
      await reverseResultsSubmissionAdvanceSettlement(tx, zoneSubmission.resultsSubmissionId);

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

  // Саму сводку по зоне пересобирать уже не из чего — сдачи нет; а вот
  // "Касса за день" точки продолжает существовать и обязана перестать
  // показывать удалённые деньги (требование владельца 2026-08-16).
  await resyncDailyCashForZone(zoneSubmission.zoneId, owner.tenantId, zoneSubmission.createdAt);

  return NextResponse.json({ ok: true });
}
