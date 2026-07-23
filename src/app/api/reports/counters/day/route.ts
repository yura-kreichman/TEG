import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcSessions, calcZoneGrossRevenue, calcZoneRevenue, isLaunchesZone, isStaysZone, isTicketsZone } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { aggregateTicketOrders, ticketRevenueByAssetVariant, listTicketOrdersForWindow, type TicketOrderWindowItem } from "@/lib/tickets";

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

  // "Прибывания" и тап-"Пуски" (после перехода на тапы, assetReadings
  // пустой) не пишут AssetReading вовсе — их валовая выручка живёт в Launch,
  // привязанном к zoneSubmissionId сервером при сдаче итогов. Без этого
  // calculatedRevenue/netRevenue ниже всегда были бы 0 для таких зон (тот же
  // класс бага, что уже пофикшен в lib/reports.ts и home-summary/route.ts —
  // реальный баг, найден пользователем 2026-07-19: зона "Игровые" в "Итогах
  // по дням" показывала Расчётная выручка=0₽ при реальной кассе 120₽/62₽).
  const liveZoneSubmissionIds = submissions
    .flatMap((s) => s.zoneSubmissions)
    .filter((zs) => isStaysZone(zs.zone) || (isLaunchesZone(zs.zone) && zs.assetReadings.length === 0))
    .map((zs) => zs.id);
  const liveLaunches = liveZoneSubmissionIds.length
    ? await prisma.launch.findMany({
        where: { zoneSubmissionId: { in: liveZoneSubmissionIds }, voidedAt: null },
        select: { id: true, zoneSubmissionId: true, assetId: true, amount: true, startedAt: true, endedAt: true, paymentMethod: true },
      })
    : [];
  const liveRevenueBySubmission = new Map<string, number>();
  // По активу — та же группировка Launch по assetId, что уже есть в
  // lib/reports.ts (computeZoneSubmissionRevenues), нужна отдельно и здесь:
  // без неё карточка вообще не показывала разбивку по активам для таких зон
  // (assets ниже строится только из assetReadings, у Launch-зон он пуст —
  // реальный пробел, найден пользователем 2026-07-19 сразу следом за фиксом
  // выручки).
  const liveAssetsBySubmission = new Map<string, Map<string, { count: number; amount: number }>>();
  // Поштучный список пусков окна — для аннулирования владельцем прямо в
  // карточке (аудит 2026-07-25: у "Прибываний"/тап-"Пусков" не было вообще
  // никакого способа исправить ошибочный/тестовый пуск, в отличие от
  // Билетов — см. /api/launches/[id]/void).
  const liveLaunchDetailsBySubmission = new Map<
    string,
    { id: string; assetId: string; startedAt: string; endedAt: string | null; amount: number; paymentMethod: string | null }[]
  >();
  for (const l of liveLaunches) {
    if (!l.zoneSubmissionId) continue;
    liveRevenueBySubmission.set(
      l.zoneSubmissionId,
      (liveRevenueBySubmission.get(l.zoneSubmissionId) ?? 0) + Number(l.amount ?? 0)
    );
    const details = liveLaunchDetailsBySubmission.get(l.zoneSubmissionId) ?? [];
    details.push({
      id: l.id,
      assetId: l.assetId ?? "",
      startedAt: l.startedAt.toISOString(),
      endedAt: l.endedAt?.toISOString() ?? null,
      amount: Number(l.amount ?? 0),
      paymentMethod: l.paymentMethod,
    });
    liveLaunchDetailsBySubmission.set(l.zoneSubmissionId, details);
    if (!l.assetId) continue;
    const bySubmission = liveAssetsBySubmission.get(l.zoneSubmissionId) ?? new Map();
    const bucket = bySubmission.get(l.assetId) ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += Number(l.amount ?? 0);
    bySubmission.set(l.assetId, bucket);
    liveAssetsBySubmission.set(l.zoneSubmissionId, bySubmission);
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
  // "stays"/"launches"/"counters"/"cash_only" — именно там абонемент вообще
  // применим как способ оплаты (запрос пользователя 2026-07-20: "актуально
  // не только для счётчиков, но и Только касса" — изначально только
  // stays/launches, см. lib/abonement.ts spendWalletForZone).
  const abonementEligibleZoneIds = [
    ...new Set(
      submissions.flatMap((s) =>
        s.zoneSubmissions
          .filter((zs) =>
            ["stays", "launches", "counters", "cash_only"].includes(zs.zone.accountingMode)
          )
          .map((zs) => zs.zoneId)
      )
    ),
  ];

  const boundariesByZone = new Map<string, Date[]>();
  const abonementOpsByZone = new Map<string, { amount: number; occurredAt: Date }[]>();
  if (abonementEligibleZoneIds.length) {
    const [allZoneSubmissions, abonementOps] = await Promise.all([
      prisma.zoneSubmission.findMany({
        where: { zoneId: { in: abonementEligibleZoneIds } },
        orderBy: { createdAt: "asc" },
        select: { zoneId: true, createdAt: true },
      }),
      prisma.moneyOperation.findMany({
        where: { zoneId: { in: abonementEligibleZoneIds }, type: "revenue_abonement" },
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

  // Билеты (docs/spec/10-tickets.md, "Отчёты", п.2-3) — карточка сдачи в
  // паттерне "stays": агрегат (заказов/билетов/погашено/истекло) + разрез по
  // активам и вариантам. Заказы не привязаны к zoneSubmissionId (в отличие от
  // Launch у Прибываний/Пусков — билеты разнесены во времени от сдачи),
  // поэтому окно восстанавливается по ВСЕЙ истории сдач зоны, тот же приём,
  // что boundariesByZone/abonementAmountFor выше, но своя карта (тикетам
  // revenue_abonement не пишется — их абонементная сумма уже сидит в
  // aggregateTicketOrders напрямую, MoneyOperation здесь не нужен).
  const ticketZoneIds = [
    ...new Set(submissions.flatMap((s) => s.zoneSubmissions.filter((zs) => isTicketsZone(zs.zone)).map((zs) => zs.zoneId))),
  ];
  const ticketBoundariesByZone = new Map<string, Date[]>();
  if (ticketZoneIds.length) {
    const allTicketZoneSubmissions = await prisma.zoneSubmission.findMany({
      where: { zoneId: { in: ticketZoneIds } },
      orderBy: { createdAt: "asc" },
      select: { zoneId: true, createdAt: true },
    });
    for (const row of allTicketZoneSubmissions) {
      const list = ticketBoundariesByZone.get(row.zoneId) ?? [];
      list.push(row.createdAt);
      ticketBoundariesByZone.set(row.zoneId, list);
    }
  }
  const ticketZoneSubmissions = submissions.flatMap((s) => s.zoneSubmissions.filter((zs) => isTicketsZone(zs.zone)));
  const ticketDataBySubmission = new Map<
    string,
    {
      totalAmount: number;
      abonementAmount: number;
      ordersCount: number;
      ticketsCount: number;
      redeemedCount: number;
      expiredCount: number;
      assets: { assetId: string; variantName: string; count: number; amount: number }[];
      orders: TicketOrderWindowItem[];
    }
  >();
  await Promise.all(
    ticketZoneSubmissions.map(async (zs) => {
      const boundaries = ticketBoundariesByZone.get(zs.zoneId) ?? [];
      const idx = boundaries.findIndex((d) => d.getTime() === zs.createdAt.getTime());
      const start = idx > 0 ? boundaries[idx - 1] : null;
      const end = zs.createdAt;
      const [agg, breakdown, orders] = await Promise.all([
        aggregateTicketOrders(zs.zoneId, start, end),
        ticketRevenueByAssetVariant(zs.zoneId, start, end),
        // Полные заказы окна — для аннулирования владельцем прямо в
        // карточке (запрос пользователя 2026-07-21).
        listTicketOrdersForWindow(zs.zoneId, start, end),
      ]);
      ticketDataBySubmission.set(zs.id, {
        totalAmount: agg.totalAmount,
        abonementAmount: agg.abonementAmount,
        ordersCount: agg.ordersCount,
        ticketsCount: agg.ticketsCount,
        redeemedCount: agg.redeemedCount,
        expiredCount: agg.expiredCount,
        assets: breakdown.map((b) => ({ assetId: b.assetId, variantName: b.variantName, count: b.count, amount: b.amount })),
        orders,
      });
    })
  );

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

      // "Прибывания"/тап-"Пуски" считают выручку от Launch, не от счётчика —
      // у них нет ни AssetReading, ни отдельного понятия "тестовый пуск" на
      // этом уровне (voidedAt уже исключает отменённые), поэтому gross и net
      // здесь совпадают, в отличие от "Счётчиков" ниже.
      const isLiveZone = isStaysZone(zs.zone) || (isLaunches && zs.assetReadings.length === 0);
      const isTickets = isTicketsZone(zs.zone);
      const ticketData = isTickets ? ticketDataBySubmission.get(zs.id) : undefined;
      // "Счёт." — всегда валовая выручка по счётчикам, ФАКТ (запрос
      // пользователя 2026-07-16). Разница считается от net (за вычетом тестов).
      const calculatedRevenue = isTickets
        ? (ticketData?.totalAmount ?? 0)
        : isLiveZone
          ? (liveRevenueBySubmission.get(zs.id) ?? 0)
          : calcZoneGrossRevenue(tariffCalc);
      const netRevenue = isTickets
        ? (ticketData?.totalAmount ?? 0)
        : isLiveZone
          ? (liveRevenueBySubmission.get(zs.id) ?? 0)
          : calcZoneRevenue(tariffCalc, zs.returnsCount);
      const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
      // Справочно, рядом с cashAmount/mobileAmount — сумма реальна, но касса
      // точки её уже получила раньше, при пополнении, поэтому она намеренно
      // не входит в actualCash (запрос пользователя 2026-07-17: "во всех
      // отчётах... правильные цифры", "к Наличный и Безнал добавить
      // Абонемент"). Но ОНА ЖЕ вычитается из netRevenue при расчёте
      // difference ниже — иначе разница ложно показывала бы недостачу ровно
      // на эту сумму каждый раз (реальный баг, найден пользователем
      // 2026-07-18 через собственный числовой пример).
      const abonementAmount = isTickets
        ? (ticketData?.abonementAmount ?? 0)
        : ["stays", "launches", "counters", "cash_only"].includes(zs.zone.accountingMode)
          ? abonementAmountFor(zs.zoneId, zs.createdAt)
          : 0;
      // cash_only: "Расчётной выручки и разницы не существует — сравнивать
      // не с чем" (docs/spec/01-counters.md, "Расчёт") — без этой ветки
      // difference молча считался как actualCash+abonementAmount−0
      // (netRevenue у cash_only всегда 0, tariffCalc пуст), т.е. фактически
      // равнялся полной кассе зоны, а не нулю. Карточка зоны эту строку не
      // показывает (UI-условие ниже), но daySummary суммирует difference по
      // ВСЕМ card без исключений — реальный баг, найден при аудите
      // 2026-07-22: касса cash_only-зоны просачивалась в итоговую "Разницу"
      // дня, искажая её на точках, где есть и cash_only, и другие зоны.
      const difference =
        zs.zone.accountingMode === "cash_only"
          ? 0
          : Math.round((actualCash + abonementAmount - netRevenue) * 100) / 100;

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

      // Разбивка по активам для "Прибываний"/тап-"Пусков" — из Launch, не из
      // assetReadings (см. комментарий у liveAssetsBySubmission выше). Форма
      // сознательно другая, чем у "readings" (нет "было→стало" — у пусков нет
      // непрерывного счётчика, только дискретные события): count+amount, тот
      // же стиль, что уже показывает список проданных абонементов.
      const liveAssetBuckets = liveAssetsBySubmission.get(zs.id);
      const liveAssets = liveAssetBuckets
        ? zs.zone.assets
            .filter((asset) => liveAssetBuckets.has(asset.id))
            .map((asset) => {
              const bucket = liveAssetBuckets.get(asset.id)!;
              return {
                assetId: asset.id,
                assetName: asset.name,
                colorTag: asset.colorTag,
                photoUrl: asset.photoUrl,
                iconKey: asset.iconKey,
                count: bucket.count,
                amount: Math.round(bucket.amount * 100) / 100,
              };
            })
        : [];

      // Разрez по активам и вариантам для Билетов (docs/spec/10-tickets.md,
      // "Отчёты", п.2: "раскрытие разреза по активам и вариантам внутри
      // карточки") — asset name резолвится тут же, ticketRevenueByAssetVariant
      // отдаёт только id.
      const ticketAssets = (ticketData?.assets ?? []).map((b) => ({
        assetId: b.assetId,
        assetName: zs.zone.assets.find((a) => a.id === b.assetId)?.name ?? "",
        variantName: b.variantName,
        count: b.count,
        amount: b.amount,
      }));

      return {
        zoneSubmissionId: zs.id,
        zoneId: zs.zoneId,
        zoneName: zs.zone.name,
        zoneIconKey: zs.zone.iconKey,
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
        liveAssets,
        liveLaunches: (liveLaunchDetailsBySubmission.get(zs.id) ?? []).map((l) => ({
          ...l,
          assetName: zs.zone.assets.find((a) => a.id === l.assetId)?.name ?? "",
        })),
        // Билеты (docs/spec/10-tickets.md, "Отчёты", п.2-3) — заказов/билетов
        // агрегат + "Погашено X из Y · истекло Z", только у зон гашения
        // (докс: "при включённом гашении — две строки"; при выключенном
        // гашения нет и погашенных не существует, ticketData всё равно 0/0).
        ticketsOrdersCount: ticketData?.ordersCount ?? null,
        ticketsCount: ticketData?.ticketsCount ?? null,
        ticketsRedeemedCount: ticketData?.redeemedCount ?? null,
        ticketsExpiredCount: ticketData?.expiredCount ?? null,
        ticketRedemptionEnabled: isTickets ? zs.zone.ticketRedemptionEnabled : null,
        ticketAssets,
        // Заказы окна с полным составом билетов — для аннулирования владельцем
        // прямо в карточке (запрос пользователя 2026-07-21: "прямо в карточке
        // Итогов дня", не отдельный экран). Имя актива резолвится тут же, как
        // и у ticketAssets выше.
        ticketOrders: (ticketData?.orders ?? []).map((o) => ({
          ...o,
          tickets: o.tickets.map((tk) => ({
            ...tk,
            assetName: zs.zone.assets.find((a) => a.id === tk.assetId)?.name ?? "",
          })),
        })),
      };
    })
  );

  return NextResponse.json({ cards, abonementSales });
}
