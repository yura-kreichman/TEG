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

  // Считаем ЗДЕСЬ, а не в конце транзакции: денежный блок ниже обязан знать,
  // менялось ли хоть что-нибудь. Раньше он выполнялся всегда — и пустое
  // «Сохранить» уводило деньги, не оставляя записи в журнале правок
  // (генеральная проверка финансов 2026-09-02).
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  // Насколько поменялась касса — именно ДЕЛЬТА, не новое значение. Сдача
  // пишет в revenue не введённую сумму, а «введённое + компенсированные
  // расходы» (submit-results/route.ts:803: сотрудник вводит остаток ПОСЛЕ
  // своих трат). Перезапись значением стирала компенсацию, и расход
  // вычитался второй раз: получил 1000, купил на 350, ввёл 650 → в кассе
  // зоны 650; владелец жмёт «Сохранить» → revenue := 650 → касса 300 при
  // 650 в ящике. Пересчитать компенсацию заново нельзя:
  // getExpenseCompensation фильтрует resultsSubmissionId: null и для уже
  // закрытой сдачи вернёт ноль.
  const cashDelta = Math.round((nextCash - before.cashAmount) * 100) / 100;

  await prisma.$transaction(async (tx) => {
    // Лок точки на всю правку. Его здесь не было вовсе, хотя
    // reverseResultsSubmissionAdvanceSettlement в собственной документации
    // требует вызывать себя «изнутри уже залоченной транзакции» — и правка, и
    // удаление сдачи молча нарушали это условие (генеральная проверка
    // финансов 2026-09-02). Параллельная инкассация той же точки читала
    // остатки зон между откатом погашения аванса и записью новой суммы и
    // списывала одни деньги дважды — тот же класс гонки, что уже закрыт для
    // всех роутов инкассации и авансов.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${zoneSubmission.zone.pointId}))`;

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
    if (changed && cashDelta !== 0) {
      if (revenueOp) {
        // Сдвигаем на дельту, сохраняя компенсацию расходов внутри суммы.
        // Удаляем, только если после сдвига не осталось положительного
        // остатка: прежнее условие «nextCash === 0 → удалить» выбрасывало
        // вместе с выручкой и компенсацию, уводя зону в минус на сумму трат
        // при пустом ящике.
        const nextAmount = Math.round((Number(revenueOp.amount) + cashDelta) * 100) / 100;
        if (nextAmount > 0) {
          await tx.moneyOperation.update({ where: { id: revenueOp.id }, data: { amount: nextAmount } });
        } else {
          await tx.moneyOperation.delete({ where: { id: revenueOp.id } });
        }
      } else if (nextCash > 0) {
        // Операции не было вовсе — компенсировать нечего, пишем введённое.
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
    }

    // Безнал — та же логика, отдельный тип revenue_cashless (см. submit-results/route.ts).
    const revenueCashlessOp = await tx.moneyOperation.findFirst({
      where: {
        resultsSubmissionId: zoneSubmission.resultsSubmissionId,
        zoneId: zoneSubmission.zoneId,
        type: "revenue_cashless",
      },
    });
    // Безнал перезаписывается ЗНАЧЕНИЕМ, и это верно: компенсации расходов у
    // него нет (расходы платят наличными), сдача пишет туда ровно введённую
    // сумму. Под `changed` всё равно ставим — при пустом сохранении трогать
    // журнал незачем.
    if (changed && nextMobile > 0) {
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
    } else if (changed && revenueCashlessOp) {
      await tx.moneyOperation.delete({ where: { id: revenueCashlessOp.id } });
    }

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
      // Тот же лок точки, что и в PATCH выше, и по той же причине: ниже
      // вызывается reverseResultsSubmissionAdvanceSettlement, требующий
      // залоченной транзакции.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${zoneSubmission.zone.pointId}))`;

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
