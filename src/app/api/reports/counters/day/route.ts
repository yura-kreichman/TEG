import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneGrossRevenue, calcZoneRevenue } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

interface CorrectionDiff {
  cashAmount: number;
  mobileAmount: number;
  returnsCount: number;
  readings: Record<string, number>;
}

// Compact per-day breakdown for a point: one card per zone-submission that
// day (docs/design/prototype-owner-readings-v1.html), with the reading chain
// (previous → current) per tariff, cash/mobile, расчётная выручка/разница
// (recomputed here — only raw cashAmount/mobileAmount/returnsCount/readings
// are persisted, not the derived numbers), whether the card is still the last
// link in its assets' chains (editable), and audit info from CorrectionLog.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");
  const date = searchParams.get("date"); // "YYYY-MM-DD"

  if (!pointId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Продажа абонементов (планов) за эту дату+точку — независимо от Сдачи
  // итогов (запрос пользователя 2026-07-18: "в Итогах дня и остатках на
  // точке это должно быть... Сотруднику не надо вводить Наличные или
  // Безнал, нам это и так известно при продаже"). Единственный источник —
  // MoneyOperation (реальные деньги, MoneyOperation.abonementId — какой
  // план): НЕ AbonementTransaction.amount (это creditAmount с учётом
  // бонуса — другая цифра) и НЕ ТЕКУЩАЯ цена плана (Abonement.price могла
  // измениться с тех пор — реальный баг, найденный пользователем: сумма по
  // плану в списке и итоговая сумма внизу расходились). Отдельным
  // "карманом" от карточек зон — эти деньги не привязаны ни к одной зоне.
  const abonementSalesOps = await prisma.moneyOperation.findMany({
    where: {
      pointId,
      type: { in: ["abonement_topup", "abonement_topup_cashless"] },
      occurredAt: { gte: dayStart, lt: dayEnd },
    },
    select: { abonementId: true, amount: true, type: true },
  });
  const abonementSalesTotals = abonementSalesOps.reduce(
    (acc, op) => {
      const amount = Number(op.amount);
      if (op.type === "abonement_topup_cashless") acc.mobile += amount;
      else acc.cash += amount;
      return acc;
    },
    { cash: 0, mobile: 0 }
  );

  // Разбивка по конкретным планам — по аналогии с тем, как карточка зоны
  // показывает список активов с тарифом (запрос пользователя 2026-07-18:
  // "Абонемент — это Актив, Тариф — это стоимость абонемента... может так и
  // стоит отображать"). Одна строка на план ("не надо полный список
  // продаж... просто Абонемент и его количество продаж по Наличному и
  // безналичному"), сумма — реальная (из MoneyOperation), не пересчитанная.
  const planIds = [...new Set(abonementSalesOps.map((op) => op.abonementId).filter((id): id is string => !!id))];
  const plans = planIds.length
    ? await prisma.abonement.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } })
    : [];
  const planById = new Map(plans.map((p) => [p.id, p]));

  const abonementSaleItemsByPlan = new Map<
    string,
    { abonementId: string; name: string | null; cashAmount: number; cashCount: number; mobileAmount: number; mobileCount: number }
  >();
  for (const op of abonementSalesOps) {
    const plan = op.abonementId ? planById.get(op.abonementId) : undefined;
    if (!op.abonementId || !plan) continue;
    const existing = abonementSaleItemsByPlan.get(op.abonementId) ?? {
      abonementId: op.abonementId,
      name: plan.name,
      cashAmount: 0,
      cashCount: 0,
      mobileAmount: 0,
      mobileCount: 0,
    };
    const amount = Number(op.amount);
    if (op.type === "abonement_topup_cashless") {
      existing.mobileAmount += amount;
      existing.mobileCount += 1;
    } else {
      existing.cashAmount += amount;
      existing.cashCount += 1;
    }
    abonementSaleItemsByPlan.set(op.abonementId, existing);
  }
  const abonementSales = { ...abonementSalesTotals, items: [...abonementSaleItemsByPlan.values()] };

  const submissions = await prisma.resultsSubmission.findMany({
    where: { pointId, submittedAt: { gte: dayStart, lt: dayEnd } },
    include: {
      operator: { select: { name: true } },
      zoneSubmissions: {
        include: {
          zone: { include: { tariffs: true, assets: { orderBy: { sortOrder: "asc" } } } },
          assetReadings: true,
        },
      },
    },
    // Newest submission first — that's the one an owner is most likely checking
    // (and the only one still editable, per the lock-chain rule below).
    orderBy: { submittedAt: "desc" },
  });

  if (submissions.length === 0) {
    return NextResponse.json({ cards: [], abonementSales });
  }

  // Sessions/previous-value are always computed from the immediately preceding
  // reading of the same asset+tariff, regardless of date — so we walk the
  // asset's whole reading history chronologically rather than only this day's
  // rows. The same pass also tells us, per reading, whether it's the LAST one
  // recorded for its asset+tariff — i.e. whether its zone-submission is still
  // editable (see docs/spec/01-counters.md, "Прозрачность"). Only "counters"
  // zones have this chain at all — "launches" readings are already the
  // finished count, "cash_only" zones have no readings to begin with.
  const assetIds = new Set<string>();
  for (const s of submissions) {
    for (const zs of s.zoneSubmissions) {
      if (zs.zone.accountingMode !== "counters") continue;
      for (const r of zs.assetReadings) assetIds.add(r.assetId);
    }
  }

  const allReadings = assetIds.size
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: [...assetIds] } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const initialByKey = await getInitialReadingsMap([...assetIds]);
  const runningPrevious = new Map<string, number>(initialByKey);
  const previousById = new Map<string, number>();
  const sessionsById = new Map<string, number>();
  const lastReadingIdByKey = new Map<string, string>();
  for (const r of allReadings) {
    const key = `${r.assetId}:${r.tariffId}`;
    const previous = runningPrevious.get(key) ?? 0;
    previousById.set(r.id, previous);
    sessionsById.set(r.id, calcSessions(r.reading, previous));
    runningPrevious.set(key, r.reading);
    lastReadingIdByKey.set(key, r.id);
  }

  // Абонементная выручка (revenue_abonement) не привязана к ZoneSubmission —
  // признаётся сразу в момент траты, а не при сдаче итогов (запрос
  // пользователя 2026-07-17), поэтому её нет в zs.cashAmount/mobileAmount.
  // Чтобы показать её в ПРАВИЛЬНОМ окне для конкретной прошлой сдачи (между
  // ней и предыдущей сдачей той же зоны — тот же принцип, что у
  // previousSubmissionBoundary в lib/game-room.ts для текущего незакрытого
  // окна), строим полную цепочку сдач по каждой зоне режима
  // "stays"/"launches" — именно там абонемент вообще применим как способ
  // оплаты.
  const gameRoomZoneIds = [
    ...new Set(
      submissions.flatMap((s) =>
        s.zoneSubmissions
          .filter((zs) => zs.zone.accountingMode === "stays" || zs.zone.accountingMode === "launches")
          .map((zs) => zs.zoneId)
      )
    ),
  ];

  const boundariesByZone = new Map<string, Date[]>();
  const abonementOpsByZone = new Map<string, { amount: number; occurredAt: Date }[]>();
  if (gameRoomZoneIds.length) {
    const [allZoneSubmissions, abonementOps] = await Promise.all([
      prisma.zoneSubmission.findMany({
        where: { zoneId: { in: gameRoomZoneIds } },
        orderBy: { createdAt: "asc" },
        select: { zoneId: true, createdAt: true },
      }),
      prisma.moneyOperation.findMany({
        where: { zoneId: { in: gameRoomZoneIds }, type: "revenue_abonement" },
        select: { zoneId: true, amount: true, occurredAt: true },
      }),
    ]);
    for (const row of allZoneSubmissions) {
      const list = boundariesByZone.get(row.zoneId) ?? [];
      list.push(row.createdAt);
      boundariesByZone.set(row.zoneId, list);
    }
    for (const op of abonementOps) {
      // zoneId гарантированно заполнен — фильтр выше требует его "in"
      // непустого списка id, но Prisma не сужает тип по WHERE.
      if (!op.zoneId) continue;
      const list = abonementOpsByZone.get(op.zoneId) ?? [];
      list.push({ amount: Number(op.amount), occurredAt: op.occurredAt });
      abonementOpsByZone.set(op.zoneId, list);
    }
  }

  function abonementAmountFor(zoneId: string, submissionCreatedAt: Date): number {
    const boundaries = boundariesByZone.get(zoneId);
    const ops = abonementOpsByZone.get(zoneId);
    if (!boundaries || !ops) return 0;
    const idx = boundaries.findIndex((d) => d.getTime() === submissionCreatedAt.getTime());
    const windowStart = idx > 0 ? boundaries[idx - 1] : null;
    const sum = ops
      .filter((op) => op.occurredAt <= submissionCreatedAt && (!windowStart || op.occurredAt > windowStart))
      .reduce((acc, op) => acc + op.amount, 0);
    return Math.round(sum * 100) / 100;
  }

  const zoneSubmissionIds = submissions.flatMap((s) => s.zoneSubmissions.map((zs) => zs.id));
  const correctionLogs = zoneSubmissionIds.length
    ? await prisma.correctionLog.findMany({
        where: { entityType: "ZoneSubmission", entityId: { in: zoneSubmissionIds } },
        orderBy: { correctedAt: "desc" },
      })
    : [];
  const latestLogByZoneSubmissionId = new Map<string, (typeof correctionLogs)[number]>();
  for (const log of correctionLogs) {
    if (!latestLogByZoneSubmissionId.has(log.entityId)) latestLogByZoneSubmissionId.set(log.entityId, log);
  }

  const cards = submissions.flatMap((s) =>
    s.zoneSubmissions.map((zs) => {
      const isLaunches = zs.zone.accountingMode === "launches";
      const readingSessions = (r: (typeof zs.assetReadings)[number]) =>
        isLaunches ? r.reading : (sessionsById.get(r.id) ?? 0);

      const tariffCalc = zs.zone.tariffs.map((tariff) => ({
        tariffId: tariff.id,
        price: Number(tariff.price),
        sessions: zs.assetReadings
          .filter((r) => r.tariffId === tariff.id)
          .reduce((sum, r) => sum + readingSessions(r), 0),
      }));

      // "Счёт." — всегда валовая выручка по счётчикам, ФАКТ (запрос
      // пользователя 2026-07-16). Разница считается от net (за вычетом тестов).
      const calculatedRevenue = calcZoneGrossRevenue(tariffCalc);
      const netRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
      const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
      // Справочно, рядом с cashAmount/mobileAmount — сумма реальна, но касса
      // точки её уже получила раньше, при пополнении, поэтому она намеренно
      // не входит в actualCash (запрос пользователя 2026-07-17: "во всех
      // отчётах... правильные цифры", "к Наличный и Безнал добавить
      // Абонемент"). Но ОНА ЖЕ вычитается из netRevenue при расчёте
      // difference ниже — иначе разница ложно показывала бы недостачу ровно
      // на эту сумму каждый раз (реальный баг, найден пользователем
      // 2026-07-18 через собственный числовой пример).
      const abonementAmount =
        zs.zone.accountingMode === "stays" || zs.zone.accountingMode === "launches"
          ? abonementAmountFor(zs.zoneId, zs.createdAt)
          : 0;
      const difference = Math.round((actualCash + abonementAmount - netRevenue) * 100) / 100;

      const editable =
        zs.zone.accountingMode !== "counters" ||
        zs.assetReadings.every((r) => lastReadingIdByKey.get(`${r.assetId}:${r.tariffId}`) === r.id);

      const log = latestLogByZoneSubmissionId.get(zs.id);
      const before = log?.beforeJson as CorrectionDiff | undefined;
      const after = log?.afterJson as CorrectionDiff | undefined;
      const cashEditedBefore = before && after && before.cashAmount !== after.cashAmount ? before.cashAmount : null;
      const edited = log ? { at: log.correctedAt, reason: log.comment } : null;

      const assets = zs.zone.assets
        .map((asset) => ({
          assetId: asset.id,
          assetName: asset.name,
          colorTag: asset.colorTag,
          photoUrl: asset.photoUrl,
          iconKey: asset.iconKey,
          readings: zs.assetReadings
            .filter((r) => r.assetId === asset.id)
            .map((r) => {
              const tariff = zs.zone.tariffs.find((t) => t.id === r.tariffId);
              const key = `${asset.id}:${tariff?.id}`;
              const editedBefore =
                before && after && before.readings[key] !== after.readings[key] ? before.readings[key] : null;
              return {
                tariffId: r.tariffId,
                tariffName: tariff?.name ?? "",
                previousValue: isLaunches ? null : (previousById.get(r.id) ?? 0),
                value: r.reading,
                sessions: readingSessions(r),
                editedBefore,
              };
            }),
        }))
        .filter((a) => a.readings.length > 0);

      return {
        zoneSubmissionId: zs.id,
        zoneId: zs.zoneId,
        zoneName: zs.zone.name,
        accountingMode: zs.zone.accountingMode,
        submittedAt: s.submittedAt,
        operatorName: s.operator.name,
        editable,
        edited,
        cashAmount: Number(zs.cashAmount),
        cashEditedBefore,
        mobileAmount: Number(zs.mobileAmount),
        abonementAmount,
        returnsCount: zs.returnsCount,
        calculatedRevenue,
        netRevenue,
        difference,
        // Цены тарифов — чтобы владелец видел пересчитанные Расчёт/Разница
        // живьём при редактировании показаний (запрос пользователя
        // 2026-07-15), не только после сохранения.
        tariffs: zs.zone.tariffs.map((t) => ({ tariffId: t.id, price: Number(t.price) })),
        assets,
      };
    })
  );

  return NextResponse.json({ cards, abonementSales });
}
