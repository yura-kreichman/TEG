import { prisma } from "@/lib/prisma";
import { calcSessions, calcZoneRevenue, isLaunchesZone, isStaysZone, isTicketsZone } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { aggregateTicketOrders, ticketRevenueByAssetVariant } from "@/lib/tickets";
import { localDateParts, zonedWallTimeToUtc } from "@/lib/business-day";

function addCalendarDays(parts: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export type PeriodGranularity = "day" | "week" | "month" | "year";
// Было отдельным типом без "day" (week/month/year), т.к. переключатель точки
// изначально не имел День/Период — теперь это тот же переключатель, что у
// Денег/Товаров (запрос пользователя 2026-07-20), поэтому просто алиас;
// оставлен только чтобы не трогать все места, где он уже импортирован по
// имени, — реального смыслового различия с PeriodGranularity больше нет.
export type ReportGranularity = PeriodGranularity;

export function isPeriodGranularity(value: unknown): value is PeriodGranularity {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

export const isReportGranularity = isPeriodGranularity;

/**
 * Calendar period (day/week/month/year) containing `anchor`, truncated to
 * `today` so an in-progress period doesn't silently include days that
 * haven't happened yet. Shared by the per-point reports (week/month only,
 * via `ReportGranularity`) and /api/reports/money (all four).
 *
 * Границы — в КАЛЕНДАРЕ ЧАСОВОГО ПОЯСА ТЕНАНТА (Tenant.timezone), не в сыром
 * UTC сервера (РЕАЛЬНЫЙ БАГ, найден при повторном аудите 2026-07-25: тот же
 * класс, что уже чинили для business-day.ts/isWithinShiftStartWindow
 * 2026-07-12 — "anchor.getUTCFullYear()" читает календарную дату по UTC,
 * которая для тенанта восточнее/западнее UTC у полуночи может отличаться от
 * реального местного дня на сутки, "Сегодня"/"Неделя"/"Месяц" в Отчётах
 * могли молча включать/исключать не те данные).
 */
export function getPeriodRange(granularity: PeriodGranularity, anchor: Date, today: Date, timezone: string) {
  const a = localDateParts(anchor, timezone);
  const toUtc = (p: { year: number; month: number; day: number }) => zonedWallTimeToUtc(p.year, p.month, p.day, 0, 0, timezone);

  let startParts: { year: number; month: number; day: number };
  let endParts: { year: number; month: number; day: number };
  if (granularity === "day") {
    startParts = a;
    endParts = addCalendarDays(a, 1);
  } else if (granularity === "week") {
    const weekday = new Date(Date.UTC(a.year, a.month - 1, a.day)).getUTCDay();
    const dayIndex = (weekday + 6) % 7; // 0=Mon
    startParts = addCalendarDays(a, -dayIndex);
    endParts = addCalendarDays(startParts, 7);
  } else if (granularity === "month") {
    startParts = { year: a.year, month: a.month, day: 1 };
    endParts = a.month === 12 ? { year: a.year + 1, month: 1, day: 1 } : { year: a.year, month: a.month + 1, day: 1 };
  } else {
    startParts = { year: a.year, month: 1, day: 1 };
    endParts = { year: a.year + 1, month: 1, day: 1 };
  }

  const start = toUtc(startParts);
  let end = toUtc(endParts);

  const todayEnd = toUtc(addCalendarDays(localDateParts(today, timezone), 1));
  if (end > todayEnd) end = todayEnd;
  return { start, end };
}

/** Same-length period immediately before `start` — for the "vs previous period" delta. */
export function getPreviousPeriodRange(granularity: ReportGranularity, start: Date, timezone: string) {
  if (granularity === "day") {
    return { start: new Date(start.getTime() - 24 * 60 * 60 * 1000), end: start };
  }
  if (granularity === "week") {
    return { start: new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000), end: start };
  }
  const s = localDateParts(start, timezone);
  if (granularity === "year") {
    const prevYearStart = zonedWallTimeToUtc(s.year - 1, 1, 1, 0, 0, timezone);
    return { start: prevYearStart, end: start };
  }
  const prevMonthY = s.month === 1 ? s.year - 1 : s.year;
  const prevMonthM = s.month === 1 ? 12 : s.month - 1;
  const prevMonthStart = zonedWallTimeToUtc(prevMonthY, prevMonthM, 1, 0, 0, timezone);
  return { start: prevMonthStart, end: start };
}

/** Same-length window immediately before [start, end) — for custom (non-named) period "vs previous" deltas. */
export function getPreviousCustomRange(start: Date, end: Date) {
  const length = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - length), end: start };
}

/**
 * Общий парсинг периода из query — либо явный `from`/`to` (кнопка "Период"),
 * либо `granularity`+`anchor` (День/Неделя/Месяц/Год) — тот же переключатель,
 * что у /money и /goods, теперь и у поточечных Отчётов (запрос пользователя
 * 2026-07-20). Раньше в каждом из 4 роутов (dynamics/zones/operators/calendar)
 * этот разбор был скопирован отдельно и не понимал "day"/custom — вынесено
 * сюда один раз, чтобы не разъезжаться дальше.
 */
export function parseDateParam(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function resolvePeriodFromParams(
  searchParams: URLSearchParams,
  today: Date,
  timezone: string
): { start: Date; end: Date; granularity: PeriodGranularity; isCustom: boolean } {
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const fromParts = fromParam ? parseDateParam(fromParam) : null;
  const toParts = toParam ? parseDateParam(toParam) : null;
  if (fromParts && toParts) {
    // Календарные даты, выбранные владельцем ("Период" from/to) — переводим
    // в местную полночь тенанта, не в UTC-полночь строки (тот же фикс, что
    // у getPeriodRange ниже): для тенанта западнее UTC "2026-07-25T00:00Z"
    // это ещё 24 июля по месту.
    const start = zonedWallTimeToUtc(fromParts.year, fromParts.month, fromParts.day, 0, 0, timezone);
    const endParts = addCalendarDays(toParts, 1);
    const end = zonedWallTimeToUtc(endParts.year, endParts.month, endParts.day, 0, 0, timezone);
    return { start, end, granularity: "day", isCustom: true };
  }
  const granularityParam = searchParams.get("granularity");
  const granularity = isPeriodGranularity(granularityParam) ? granularityParam : "week";
  const anchorParam = searchParams.get("anchor");
  const anchorParts = anchorParam ? parseDateParam(anchorParam) : null;
  // Полдень, не полночь — избегаем любой пограничной двусмысленности при
  // обратном чтении local Date Parts внутри getPeriodRange ниже.
  const anchor = anchorParts
    ? zonedWallTimeToUtc(anchorParts.year, anchorParts.month, anchorParts.day, 12, 0, timezone)
    : today;
  const { start, end } = getPeriodRange(granularity, anchor, today, timezone);
  return { start, end, granularity, isCustom: false };
}

export interface ZoneSubmissionRevenue {
  zoneSubmissionId: string;
  zoneId: string;
  calculatedRevenue: number;
  actualCash: number;
  actualMobile: number;
  actualTotal: number;
  // Справочно — сумма пусков, оплаченных абонементом в рамках этой сдачи
  // (докс: "во всех отчётах и сводках должны быть правильные цифры", запрос
  // пользователя 2026-07-17/18). НЕ входит в actualTotal (касса её не
  // получала сейчас), но ВЫЧИТАЕТСЯ из calculatedRevenue при расчёте
  // difference ниже — иначе разница ложно показывала бы недостачу ровно на
  // эту сумму каждый раз, когда клиент платит абонементом (реальный баг,
  // найден пользователем 2026-07-18 через собственный числовой пример).
  abonementAmount: number;
  difference: number;
  // Тесты/возвраты этой сдачи (запрос пользователя 2026-07-18: "в обоих
  // должны быть видны Тесты/возвраты" — сумма по всем сдачам периода нужна
  // и на Главной, и на /money бизнес-карточке).
  returnsCount: number;
  perAsset: Map<string, number>; // assetId -> calculated revenue share (before proportional scaling)
  perTariff: Map<string, number>; // tariffId -> calculated revenue share
}

/**
 * Recomputes calculatedRevenue/difference and per-asset/per-tariff revenue
 * shares for every zone-submission of the given zones within [start, end) —
 * same chain-walking approach as /api/reports/counters/day (sessions/previous
 * reading are never persisted, only raw AssetReading.reading values are).
 * Walks each asset+tariff's FULL history (not just the window) so sessions at
 * the window's start are still diffed against the correct previous reading.
 */
export async function computeZoneSubmissionRevenues(
  zoneIds: string[],
  start: Date,
  end: Date
): Promise<ZoneSubmissionRevenue[]> {
  if (zoneIds.length === 0) return [];

  const zones = await prisma.zone.findMany({
    where: { id: { in: zoneIds } },
    include: { tariffs: true },
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const zoneSubmissions = await prisma.zoneSubmission.findMany({
    where: {
      zoneId: { in: zoneIds },
      resultsSubmission: { submittedAt: { gte: start, lt: end } },
    },
    include: { assetReadings: true, resultsSubmission: { select: { submittedAt: true, operatorId: true } } },
  });
  if (zoneSubmissions.length === 0) return [];

  const assetIds = new Set<string>();
  for (const zs of zoneSubmissions) {
    const zone = zoneById.get(zs.zoneId);
    if (zone?.accountingMode !== "counters") continue;
    for (const r of zs.assetReadings) assetIds.add(r.assetId);
  }

  const allReadings = assetIds.size
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: [...assetIds] } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  // Начальные (калибровочные) показания — сидируют "предыдущее" для самой
  // ПЕРВОЙ настоящей сдачи каждой пары актив+тариф; дальше цепочка считается
  // от реальных AssetReading как обычно (см. src/lib/asset-initial-readings.ts).
  const initialByKey = await getInitialReadingsMap([...assetIds]);

  const runningPrevious = new Map<string, number>(initialByKey);
  const sessionsById = new Map<string, number>();
  for (const r of allReadings) {
    const key = `${r.assetId}:${r.tariffId}`;
    const previous = runningPrevious.get(key) ?? 0;
    sessionsById.set(r.id, calcSessions(r.reading, previous));
    runningPrevious.set(key, r.reading);
  }

  // "Прибывания" считают выручку от пусков (Launch), не от AssetReading —
  // zoneSubmissionId проставляется каждому пуску сервером в момент сдачи
  // итогов (submit-results/route.ts), поэтому достаточно один раз выбрать
  // все пуски нужных zone-submission и сгруппировать по активу (запрос
  // пользователя 2026-07-17: "в Отчётах не отображается корректно в
  // разделах: Зоны и активы" — perAsset/calculatedRevenue были всегда 0 для
  // "Прибываний", т.к. читались только из AssetReading).
  const staysSubmissionIds = zoneSubmissions
    .filter((zs) => isStaysZone(zoneById.get(zs.zoneId)!))
    .map((zs) => zs.id);
  const gameRoomLaunches = staysSubmissionIds.length
    ? await prisma.launch.findMany({
        where: { zoneSubmissionId: { in: staysSubmissionIds }, voidedAt: null },
        select: { zoneSubmissionId: true, assetId: true, amount: true, paymentMethod: true },
      })
    : [];
  const gameRoomBySubmission = new Map<
    string,
    { calculatedRevenue: number; abonementAmount: number; perAsset: Map<string, number> }
  >();
  for (const l of gameRoomLaunches) {
    if (!l.zoneSubmissionId || !l.assetId) continue;
    const bucket =
      gameRoomBySubmission.get(l.zoneSubmissionId) ?? { calculatedRevenue: 0, abonementAmount: 0, perAsset: new Map() };
    const amount = Number(l.amount ?? 0);
    bucket.calculatedRevenue += amount;
    if (l.paymentMethod === "abonement") bucket.abonementAmount += amount;
    bucket.perAsset.set(l.assetId, (bucket.perAsset.get(l.assetId) ?? 0) + amount);
    gameRoomBySubmission.set(l.zoneSubmissionId, bucket);
  }

  // "Пуски" (accountingMode="launches") — то же самое для сдач ПОСЛЕ
  // перехода на тапы по активу (запрос пользователя 2026-07-17, тот же
  // разрыв, что и у "Прибываний" выше): такие сдачи не пишут AssetReading
  // вовсе (zs.assetReadings.length === 0), выручка/perAsset считаются от
  // Launch. Старые сдачи (assetReadings есть — ручной ввод количества до
  // этой фичи) продолжают считаться по прежней ветке ниже — оба вида
  // взаимоисключающи для одной сдачи. В отличие от "Прибываний", тариф на
  // пуске известен (Launch.tariffId), поэтому perTariff строится и здесь.
  const launchesTallySubmissionIds = zoneSubmissions
    .filter((zs) => isLaunchesZone(zoneById.get(zs.zoneId)!) && zs.assetReadings.length === 0)
    .map((zs) => zs.id);
  const launchesTallies = launchesTallySubmissionIds.length
    ? await prisma.launch.findMany({
        where: { zoneSubmissionId: { in: launchesTallySubmissionIds }, voidedAt: null },
        select: { zoneSubmissionId: true, assetId: true, tariffId: true, amount: true, paymentMethod: true },
      })
    : [];
  const launchesTallyBySubmission = new Map<
    string,
    { calculatedRevenue: number; abonementAmount: number; perAsset: Map<string, number>; perTariff: Map<string, number> }
  >();
  for (const l of launchesTallies) {
    if (!l.zoneSubmissionId || !l.assetId || !l.tariffId) continue;
    const bucket =
      launchesTallyBySubmission.get(l.zoneSubmissionId) ??
      { calculatedRevenue: 0, abonementAmount: 0, perAsset: new Map(), perTariff: new Map() };
    const amount = Number(l.amount ?? 0);
    bucket.calculatedRevenue += amount;
    if (l.paymentMethod === "abonement") bucket.abonementAmount += amount;
    bucket.perAsset.set(l.assetId, (bucket.perAsset.get(l.assetId) ?? 0) + amount);
    bucket.perTariff.set(l.tariffId, (bucket.perTariff.get(l.tariffId) ?? 0) + amount);
    launchesTallyBySubmission.set(l.zoneSubmissionId, bucket);
  }

  // Билеты (docs/spec/10-tickets.md, "Отчёты": "money-роуты... получают её
  // автоматически через общий калькулятор — добавь isTicketsZone и ветку
  // агрегата") — тот же класс пробела, что уже был у "Прибываний"/"Пусков"
  // выше: без своей ветки zone.tariffs пуст, calcZoneRevenue([], ...) всегда
  // даёт 0. В отличие от Launch, у Билетов нет zoneSubmissionId на заказе
  // (заказы разнесены во времени от сдачи) — окно восстанавливается по
  // ВСЕЙ истории сдач зоны (не только внутри текущего периода отчёта, иначе
  // первая сдача периода не знала бы своей настоящей предыдущей границы),
  // тот же приём, что boundariesByZone/abonementAmountFor в
  // /api/reports/counters/day/route.ts.
  const ticketZoneIds = zones.filter((z) => isTicketsZone(z)).map((z) => z.id);
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
  function ticketWindowFor(zoneId: string, submissionCreatedAt: Date): { start: Date | null; end: Date } {
    const boundaries = ticketBoundariesByZone.get(zoneId) ?? [];
    const idx = boundaries.findIndex((d) => d.getTime() === submissionCreatedAt.getTime());
    return { start: idx > 0 ? boundaries[idx - 1] : null, end: submissionCreatedAt };
  }
  const ticketZoneSubmissions = zoneSubmissions.filter((zs) => isTicketsZone(zoneById.get(zs.zoneId)!));
  const ticketAggregateBySubmission = new Map<string, { totalAmount: number; abonementAmount: number }>();
  const ticketAssetTotalsBySubmission = new Map<string, Map<string, number>>();
  await Promise.all(
    ticketZoneSubmissions.map(async (zs) => {
      const { start, end } = ticketWindowFor(zs.zoneId, zs.createdAt);
      const [agg, breakdown] = await Promise.all([
        aggregateTicketOrders(zs.zoneId, start, end),
        ticketRevenueByAssetVariant(zs.zoneId, start, end),
      ]);
      ticketAggregateBySubmission.set(zs.id, { totalAmount: agg.totalAmount, abonementAmount: agg.abonementAmount });
      const perAssetTotals = new Map<string, number>();
      for (const b of breakdown) perAssetTotals.set(b.assetId, (perAssetTotals.get(b.assetId) ?? 0) + b.amount);
      ticketAssetTotalsBySubmission.set(zs.id, perAssetTotals);
    })
  );

  return zoneSubmissions.map((zs) => {
    const zone = zoneById.get(zs.zoneId)!;
    const isLaunches = zone.accountingMode === "launches";
    const sessionsFor = (r: (typeof zs.assetReadings)[number]) => (isLaunches ? r.reading : (sessionsById.get(r.id) ?? 0));

    let calculatedRevenue: number;
    let abonementAmount = 0;
    let perAsset: Map<string, number>;
    // "Прибывания" не хранят Tariff.id на пуске (только снапшот цены) —
    // разбивка по тарифам для этого режима не строится (остаётся пустой
    // ниже); у новых сдач "Пусков" — строится, см. ветку ниже.
    let perTariff = new Map<string, number>();

    if (isStaysZone(zone)) {
      const bucket = gameRoomBySubmission.get(zs.id);
      calculatedRevenue = bucket?.calculatedRevenue ?? 0;
      abonementAmount = bucket?.abonementAmount ?? 0;
      perAsset = bucket?.perAsset ?? new Map();
    } else if (isLaunches && zs.assetReadings.length === 0) {
      const bucket = launchesTallyBySubmission.get(zs.id);
      calculatedRevenue = bucket?.calculatedRevenue ?? 0;
      abonementAmount = bucket?.abonementAmount ?? 0;
      perAsset = bucket?.perAsset ?? new Map();
      perTariff = bucket?.perTariff ?? new Map();
    } else if (isTicketsZone(zone)) {
      const agg = ticketAggregateBySubmission.get(zs.id);
      calculatedRevenue = agg?.totalAmount ?? 0;
      abonementAmount = agg?.abonementAmount ?? 0;
      perAsset = ticketAssetTotalsBySubmission.get(zs.id) ?? new Map();
      // perTariff остаётся пустым — у Билетов цены на активах, не на
      // тарифах (docs/spec/10-tickets.md, "ЦЕНЫ — НА АКТИВАХ, НЕ ТАРИФЫ").
    } else {
      const tariffCalc = zone.tariffs.map((tariff) => ({
        tariffId: tariff.id,
        price: Number(tariff.price),
        sessions: zs.assetReadings.filter((r) => r.tariffId === tariff.id).reduce((sum, r) => sum + sessionsFor(r), 0),
      }));
      calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);

      perAsset = new Map<string, number>();
      const priceByTariff = new Map(zone.tariffs.map((t) => [t.id, Number(t.price)]));
      for (const r of zs.assetReadings) {
        const revenue = sessionsFor(r) * (priceByTariff.get(r.tariffId) ?? 0);
        perAsset.set(r.assetId, (perAsset.get(r.assetId) ?? 0) + revenue);
        perTariff.set(r.tariffId, (perTariff.get(r.tariffId) ?? 0) + revenue);
      }
    }

    const actualCash = Number(zs.cashAmount);
    const actualMobile = Number(zs.mobileAmount);
    const actualTotal = actualCash + actualMobile;
    // abonementAmount вычитается из calculatedRevenue здесь — эта касса уже
    // получила эти деньги раньше, при пополнении абонемента, не сейчас
    // (реальный баг, найден пользователем 2026-07-18: без вычитания разница
    // ложно показывала недостачу ровно на сумму пусков, оплаченных
    // абонементом, каждый раз).
    // cash_only: "Расчётной выручки и разницы не существует — сравнивать не
    // с чем" (docs/spec/01-counters.md, "Расчёт") — без этой ветки difference
    // молча считался как actualTotal+abonementAmount−0 (calculatedRevenue у
    // cash_only всегда 0, tariffs пуст), т.е. фактически равнялся полной
    // кассе зоны. /api/reports/money уже исключает cash_only ДО вызова этой
    // функции, но /api/points/[id]/reports/{operators,zones,dynamics} — нет,
    // из-за чего "Разница" оператора в Отчётах → Сотрудники ложно включала
    // кассу его cash_only-зон (тот же класс бага, что уже пофикшен в
    // /api/reports/counters/day/route.ts — найден при том же аудите
    // 2026-07-22, исправление отложено и забыто).
    const difference =
      zone.accountingMode === "cash_only"
        ? 0
        : Math.round((actualTotal + abonementAmount - calculatedRevenue) * 100) / 100;

    return {
      zoneSubmissionId: zs.id,
      zoneId: zs.zoneId,
      calculatedRevenue,
      actualCash,
      actualMobile,
      actualTotal,
      abonementAmount,
      difference,
      returnsCount: zs.returnsCount,
      perAsset,
      perTariff,
    };
  });
}

/** Sums a Map<string, number> field of ZoneSubmissionRevenue entries into a single per-key total. */
export function sumByKey(entries: ZoneSubmissionRevenue[], field: "perAsset" | "perTariff"): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const [key, value] of entry[field]) {
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  return totals;
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}
