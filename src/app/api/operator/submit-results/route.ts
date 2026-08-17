import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  calcSessions,
  calcZoneGrossRevenue,
  calcZoneRevenue,
  countersPaidFromBalance,
  isCountersTapAssistZone,
  isLaunchesZone,
  isStaysZone,
  isTicketsZone,
  type ZoneAccountingMode,
} from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { getZoneAbonementSpendAmount, getZoneTapAbonementAmount } from "@/lib/abonement";
import {
  aggregateGameRoomLaunches,
  countOpenLaunchesInZone,
  gameRoomRevenueByAsset,
  previousSubmissionBoundary,
} from "@/lib/game-room";
import { aggregateTicketOrders } from "@/lib/tickets";
import { dispatchZoneSummary } from "@/lib/summary-channels/dispatch";
import { ZONE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { onResultsSubmission } from "@/lib/summary-channels/daily-cash-trigger";
import { settleOutstandingCollectionAdvance } from "@/lib/zone-balance";
import { getBusinessDayBounds } from "@/lib/business-day";

// Аудит 2026-07-27 — см. комментарий у повторной проверки внутри runSubmission.
class OpenLaunchesRaceError extends Error {
  constructor(
    public zoneName: string,
    public openCount: number
  ) {
    super(`open launches race in zone ${zoneName}`);
  }
}

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

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const body = await request.json();
  const zoneSubmissions: ZoneSubmissionInput[] = body.zoneSubmissions ?? [];
  // Расходы (запрос пользователя 2026-07-25) — client payload больше не
  // читается вовсе, единственный источник — уже созданные Сотрудником
  // операции журнала (см. ниже).
  const idempotencyKey: string | null = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : null;

  if (!Array.isArray(zoneSubmissions) || zoneSubmissions.length === 0) {
    return NextResponse.json({ error: "Выберите хотя бы одну зону" }, { status: 400 });
  }

  // Защита от повторной отправки (аудит 2026-07-25, финальный проход,
  // подтверждено двумя независимыми проверками) — связь может оборваться
  // ПОСЛЕ того, как эта же сдача уже успешно создана здесь, но ДО того, как
  // ответ дошёл до клиента; клиент не может отличить это от "запрос вообще
  // не дошёл" и кладёт сдачу в офлайн-очередь на повтор с ТЕМ ЖЕ
  // idempotencyKey (см. operator/submit/page.tsx). Если сдача с этим ключом
  // уже существует — не создаём вторую, просто подтверждаем уже сделанное.
  if (idempotencyKey) {
    const existing = await prisma.resultsSubmission.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return NextResponse.json({ id: existing.id, summary: [], remindMarkDeparture: false, alreadyProcessed: true });
    }
  }

  // Re-derive everything server-side from the DB rather than trusting any
  // client-computed totals — the client only sends raw entered numbers.
  const zoneIds = zoneSubmissions.map((z) => z.zoneId);
  // active: true — деактивированная зона не должна принять сдачу итогов,
  // даже если запрос как-то обошёл список на клиенте (тот же список берётся
  // из /api/operator/submission-context, который уже её не отдаёт).
  const zones = await prisma.zone.findMany({
    where: { id: { in: zoneIds }, pointId: point.id, active: true },
    include: { tariffs: { where: { deletedAt: null } }, assets: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  if (zones.length !== zoneIds.length) {
    return NextResponse.json({ error: "Одна из зон не найдена" }, { status: 400 });
  }

  // Доступ оператора к зоне (аудит 2026-07-25: раньше проверялись только
  // тенант/точка/active самой зоны — оператор с ограниченным allowedZones мог
  // сдать итоги по ЛЮБОЙ зоне своей точки, не только по своим, если знал её
  // id, тем же классом пробела, что уже закрыт у /api/launches и
  // /api/tickets/*). allZonesAccess=true (по умолчанию) пропускает всех.
  if (!operator.allZonesAccess) {
    const allowed = await prisma.zone.findMany({
      where: { id: { in: zoneIds }, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (allowed.length !== zoneIds.length) {
      return NextResponse.json({ error: "Нет доступа к одной из выбранных зон" }, { status: 403 });
    }
  }

  // Принадлежность показаний ИМЕННО СВОЕЙ зоне (аудит 2026-07-25: assetById
  // ниже строился ПЛОСКОЙ картой по всем зонам сразу — reading.assetId/
  // tariffId клиента не проверялись на принадлежность конкретной zs.zoneId,
  // из которой они пришли. Чужой/угаданный assetId из ДРУГОЙ зоны той же
  // точки прошёл бы насквозь и записал AssetReading не туда — искажая не
  // только расчётную выручку этой сдачи, но и цепочку "предыдущее показание"
  // чужой зоны при её следующей сдаче, поскольку previousByKey ищет по
  // assetId+tariffId без учёта зоны вовсе).
  // Диапазон/знак входных чисел (аудит 2026-07-25, финальный проход) —
  // раньше не проверялись вообще, в отличие от PATCH-двойника
  // (reports/counters/zone-submission/[id]/route.ts), который жёстко
  // требует то же самое: reading — целое 0–9999 (4-разрядный счётчик,
  // отрицательное/пятизначное значение проходило через модульную формулу
  // calcSessions с переполнением-wraparound и давало произвольно большое
  // число сеансов), cashAmount/mobileAmount — конечные неотрицательные
  // числа. Клиентский визард и так ограничивает ввод, но это только UI —
  // прямой вызов API (в т.ч. испорченный офлайн-payload) их не видел.
  // returnsCount клиент тоже присылает, но с 2026-07-24 больше не участвует
  // в расчёте вообще (см. returnsCountByZone ниже) — источник истины
  // теперь только журнал ZoneReturnEvent, значение из payload здесь даже не
  // читается.
  for (const zs of zoneSubmissions) {
    if (
      !Number.isFinite(zs.cashAmount) ||
      zs.cashAmount < 0 ||
      !Number.isFinite(zs.mobileAmount) ||
      zs.mobileAmount < 0
    ) {
      return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
    }
    const zone = zoneById.get(zs.zoneId)!;
    if (zone.accountingMode !== "counters") continue;
    const zoneAssetIds = new Set(zone.assets.map((a) => a.id));
    const zoneTariffIds = new Set(zone.tariffs.map((t) => t.id));
    for (const r of zs.readings) {
      if (!zoneAssetIds.has(r.assetId) || !zoneTariffIds.has(r.tariffId)) {
        return NextResponse.json({ error: `Показание не принадлежит зоне «${zone.name}»` }, { status: 400 });
      }
      if (!Number.isInteger(r.reading) || r.reading < 0 || r.reading > 9999) {
        return NextResponse.json({ error: "Показание должно быть числом 0–9999" }, { status: 400 });
      }
    }
  }

  // Билеты (docs/spec/10-tickets.md, "ДОСТУП К СДАЧЕ") — серверная проверка,
  // не только скрытие в UI (submission-context уже отмечает такие зоны
  // флагом ticketsSubmissionAllowed=false, но обойти это со стороны клиента
  // ничего не стоит — реальная защита должна быть здесь).
  for (const zone of zones) {
    if (zone.accountingMode === "tickets" && !operator.ticketsAccess) {
      return NextResponse.json(
        { error: `Нет доступа к сдаче зоны «${zone.name}» — нужен тумблер «Продажа билетов»` },
        { status: 403 }
      );
    }
  }

  // Мягкая блокировка (docs/spec/04-game-room.md, "Деньги и сдача итогов") —
  // сдача по зоне "Прибываний" недоступна, пока в ней есть открытые пуски, без
  // обхода. С 2026-07-28 то же верно и для "Пусков" с таймерными тарифами
  // (запрос пользователя: "10 руб. за 10 минут" — та же механика "За вход",
  // открытый пуск должен быть завершён/освобождён до сдачи, иначе его сумма
  // никогда не попадёт ни в один агрегат). Проверяем ДО тяжёлого расчёта
  // ниже, чтобы не тратить его впустую.
  for (const zs of zoneSubmissions) {
    const zone = zoneById.get(zs.zoneId)!;
    if (!isStaysZone(zone) && !isLaunchesZone(zone)) continue;
    const openCount = await countOpenLaunchesInZone(zone.id);
    if (openCount > 0) {
      return NextResponse.json(
        { error: `Заверши ${openCount} активных пуск${openCount === 1 ? "" : "ов"} в зоне «${zone.name}»` },
        { status: 400 }
      );
    }
  }

  // Сверки категорий расхода здесь больше нет: категорию выбирает Сотрудник
  // в момент ввода, и проверяет её принадлежность тенанту тот же роут
  // (api/operator/zone-expense-events) — сдача итогов лишь привязывает к себе
  // готовые операции и их полей не касается.

  // Единая точка чтения ОКНА агрегации ("с прошлой сдачи по сейчас") и
  // записи самой сдачи — раньше окно (previousReadings, тапы, Прибывания/
  // Пуски, Билеты, расходы, возвраты) читалось ДО транзакции, обычными
  // SELECT без блокировки, а писалось только в транзакции ниже (аудит
  // 2026-07-26): две почти одновременные сдачи по одной и той же зоне
  // (пересменка — спека прямо допускает "сдач может быть несколько в день")
  // читали ОДНО И ТО ЖЕ окно и обе успешно коммитили — расходы/показания/
  // касса задваивались без единой ошибки. Теперь и чтение окна, и запись —
  // в ОДНОЙ транзакции, под advisory-локом по каждой зоне, взятым САМЫМ
  // первым действием: вторая сдача той же зоны ждёт коммита первой и лишь
  // потом видит её как свою границу — окна больше не пересекаются.
  // Часовой пояс/граница бизнес-дня тенанта — нужны внутри транзакции, чтобы
  // ограничить сбор расходов текущим днём (см. expenseOpsByZone ниже), и ещё
  // раз после неё для напоминания об уходе. Читаем один раз здесь.
  const tenantForTz = await prisma.tenant.findUnique({
    where: { id: point.tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  const tenantTimezone = tenantForTz?.timezone ?? "UTC";
  const tenantDayBoundary = tenantForTz?.businessDayBoundary ?? "00:00";

  async function runSubmission(tx: Prisma.TransactionClient) {
    // Сортировка — фиксированный порядок захвата локов исключает deadlock
    // между двумя сдачами, каждая из которых закрывает те же несколько зон
    // (мультизонная сдача), но в разном порядке.
    for (const zoneId of [...zoneIds].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${zoneId}))`;
    }

    // Повторная проверка открытых пусков — ПОСЛЕ захвата локов (аудит
    // 2026-07-27, реальная гонка): первая проверка выше (строка ~170) идёт
    // ДО входа в транзакцию, обычным SELECT без блокировки — между ней и
    // захватом лока здесь проходит время (валидация категорий, чтение
    // валидных categoryId и т.д.), за которое оператор на другом устройстве
    // мог успеть стартовать новый пуск в той же зоне "Прибываний". Спека
    // (docs/spec/04-game-room.md) обещает "без обхода" — без этой повторной
    // проверки внутри залоченной транзакции обход был реально возможен, не
    // только теоретически (окно расширяется тяжёлой работой транзакции для
    // мультизонных сдач). Дублирования расчёта не происходит — просто читаем
    // тот же count ещё раз, теперь уже под локом, который гарантирует, что
    // никакой конкурентный старт пуска эту проверку больше не обгонит.
    for (const zoneId of zoneIds) {
      const zone = zoneById.get(zoneId)!;
      if (!isStaysZone(zone) && !isLaunchesZone(zone)) continue;
      const openCount = await countOpenLaunchesInZone(zoneId, tx);
      if (openCount > 0) {
        throw new OpenLaunchesRaceError(zone.name, openCount);
      }
    }

    // Единый момент "сейчас" для всех агрегатов ниже (тапы Пусков/Прибываний,
    // Билеты, тапы-показания Счётчиков) — намеренно захватывается ЗДЕСЬ,
    // ПОСЛЕ локов выше, а не раньше входа в транзакцию (аудит 2026-07-26,
    // самопроверка рефакторинга: захват до локов допускал обратный порядок —
    // сдача, стартовавшая позже, но обогнавшая другую на пред-транзакционных
    // проверках и закоммитившаяся первой, могла получить now МЕНЬШЕ, чем
    // createdAt только что закоммиченной ZoneSubmission от "проигравшей по
    // времени, но выигравшей по коммиту" сдачи — окно (boundary, until]
    // становилось бы пустым/инвертированным, агрегаты молча обнулялись бы).
    // Захват после лока гарантирует монотонность: следующая транзакция той
    // же зоны ждёт коммита предыдущей, значит её now физически позже.
    const now = new Date();

    // Граница "с прошлой сдачи" на зону — считается ОДИН раз здесь, не
    // отдельным запросом в каждом из 6 циклов агрегации ниже (аудит
    // 2026-07-27, производительность: раньше одна и та же зона могла давать
    // 2-4 идентичных SELECT ZoneSubmission за один и тот же boundary, пока
    // транзакция уже держит advisory-лок — лишние round-trip продлевали
    // время его удержания без всякой пользы).
    const boundaryByZone = new Map<string, Date | null>();
    for (const zoneId of zoneIds) {
      boundaryByZone.set(zoneId, await previousSubmissionBoundary(zoneId, tx));
    }

    // "Previous reading" only means anything in "counters" mode (running meter) —
    // "launches" readings are already the finished count for this submission.
    // Зоны с countersTapAssistEnabled (запрос пользователя 2026-07-25) — берём
    // ВСЕ активы зоны, а не только те, что есть в zs.readings: клиент для таких
    // зон readings вообще не собирает (см. блок ниже), payload может прийти
    // пустым.
    const allAssetIds = zoneSubmissions.flatMap((z) => {
      const zone = zoneById.get(z.zoneId);
      if (zone?.accountingMode !== "counters") return [];
      return zone.countersTapAssistEnabled ? zone.assets.map((a) => a.id) : z.readings.map((r) => r.assetId);
    });
    const previousReadings = allAssetIds.length
      ? await tx.assetReading.findMany({
          where: { assetId: { in: allAssetIds } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const previousByKey = new Map<string, number>();
    for (const reading of previousReadings) {
      const key = `${reading.assetId}:${reading.tariffId}`;
      if (!previousByKey.has(key)) previousByKey.set(key, reading.reading);
    }
    const initialByKey = await getInitialReadingsMap(allAssetIds, tx);

    // Показания зон с countersTapAssistEnabled (запрос пользователя 2026-07-25:
  // "то, что Сотрудник натапал, и является прибавкой к счётчику") — не
  // доверяем zs.readings от клиента вовсе (тот же принцип, что уже применён к
  // returnsCount/расходам выше по файлу), пересчитываем на сервере из журнала
  // CounterTapEvent для КАЖДОЙ пары актив+тариф зоны: новое показание =
  // (предыдущее + тапы с прошлой сдачи) mod 10000 — то же правило
  // переполнения "4 разряда", что у реальных показаний (docs/spec/
  // 01-counters.md), поэтому вся дальнейшая формула сеансов (calcSessions,
  // тоже по модулю) отрабатывает БЕЗ единой правки — она не знает и не
  // должна знать, что источник числа — тапы, а не рука оператора.
  // Возвраты/тесты, привязанные к КОНКРЕТНОМУ тапу (запрос пользователя
  // 2026-07-25: "у конкретных активов был выбран конкретный метод оплаты" —
  // размазывать вычет пропорционально между тарифами больше не нужно, раз
  // известно, у какого именно тарифа он случился), см. CounterTapEvent.voidedAt.
  // По ТАРИФУ, не по активу — выручка считается на уровне тарифа.
    const voidedCountByZoneTariff = new Map<string, number>();
    // Сумма оплаты балансом, привязанная к КОНКРЕТНОМУ тапу этой зоны (запрос
    // пользователя 2026-07-25: "ошибочно включаешь оплату с Баланса в расчёт
    // Разницы") — в отличие от counterAbonementByZone ниже (вся выручка
    // "revenue_abonement" зоны — туда попадает и старое decoupled "Списать с
    // баланса", вообще не привязанное ни к какому тапу/сеансу), тут только
    // тапы, реально учтённые как сеанс в netRevenue выше — именно ИХ нужно
    // вычесть из netRevenue перед сравнением с фактической кассой, иначе
    // Разница показывает фиктивную недостачу ровно на сумму баланса (деньги за
    // неё никогда и не должны были попасть в наличные/безнал).
    const tapAbonementAmountByZone = new Map<string, number>();
    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      if (zone.accountingMode !== "counters" || !zone.countersTapAssistEnabled) continue;
      const boundary = boundaryByZone.get(zone.id) ?? null;
      const tapCounts = await tx.counterTapEvent.groupBy({
        by: ["assetId", "tariffId"],
        where: { zoneId: zone.id, createdAt: { gt: boundary ?? new Date(0), lte: now } },
        _count: { _all: true },
      });
      const tapCountByKey = new Map(tapCounts.map((tc) => [`${tc.assetId}:${tc.tariffId}`, tc._count._all]));
      zs.readings = zone.assets.flatMap((asset) =>
        zone.tariffs.map((tariff) => {
          const key = `${asset.id}:${tariff.id}`;
          const taps = tapCountByKey.get(key) ?? 0;
          const previous = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
          return { assetId: asset.id, tariffId: tariff.id, reading: (previous + taps) % 10000 };
        })
      );

      const voidedCounts = await tx.counterTapEvent.groupBy({
        by: ["tariffId"],
        where: { zoneId: zone.id, createdAt: { gt: boundary ?? new Date(0), lte: now }, voidedAt: { not: null } },
        _count: { _all: true },
      });
      for (const vc of voidedCounts) {
        voidedCountByZoneTariff.set(`${zone.id}:${vc.tariffId}`, vc._count._all);
      }

      // Разбивка оплаты (запрос пользователя 2026-07-26) — доля "Баланс"
      // сплит-тапа тоже реально списана и учтена в netRevenue как полный
      // сеанс, поэтому вычитается наравне с обычными абонементными тапами;
      // всё это внутри getZoneTapAbonementAmount, общего с Отчётами.
      const priceByTariff = new Map(zone.tariffs.map((t) => [t.id, Number(t.price)]));
      tapAbonementAmountByZone.set(
        zone.id,
        await getZoneTapAbonementAmount(zone.id, priceByTariff, boundary, now, tx)
      );
    }

    // Актив на ремонте (Asset.active=false) — read-only и на сервере, не
    // только в форме: что бы ни прислал клиент, показание принудительно
    // остаётся последним известным (запрос пользователя 2026-07-16: "сотрудник
    // не может проводить никакие операции с деактивированными сущностями").
    // Мутируем сам объект — обе последующие стадии (расчёт выручки ниже и
    // запись AssetReading дальше по файлу) используют один и тот же массив.
    const assetById = new Map(zones.flatMap((z) => z.assets.map((a) => [a.id, a])));
    for (const zs of zoneSubmissions) {
      for (const r of zs.readings) {
        const asset = assetById.get(r.assetId);
        if (asset && !asset.active) {
          const key = `${r.assetId}:${r.tariffId}`;
          r.reading = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
        }
      }
    }

  // Агрегат "Прибываний"/"Пусков" считается заранее (async, не влезает в
  // синхронный .map() ниже) — окно "с момента предыдущей сдачи по сейчас"
  // (docs/spec/04-game-room.md, "Деньги и сдача итогов"), тот же принцип, что
  // "предыдущее показание" у counters, просто без цепочки редактирования.
  // Одна и та же функция для обоих режимов (запрос пользователя 2026-07-17:
  // "Пуски" тоже read-only calculated) — запрос зоно-скопирован, а Launch
  // "Прибываний" (assetId+tariffId=null) и "Пусков" (assetId+tariffId
  // заполнены) взаимоисключающи по зоне, так что смешения не бывает.
  // totalMinutes у ПЛОСКИХ (мгновенных) тарифов "Пусков" всегда 0
  // (startedAt=endedAt), но с 2026-07-28 "Пуски" тоже могут быть
  // таймерными — тогда totalMinutes реален и используется в Telegram/email
  // сводках наравне с "Прибываниями" (см. summary-channels/*-format.ts).
    const gameRoomAggregateByZone = new Map<
      string,
      {
        calculatedRevenue: number;
        count: number;
        totalMinutes: number;
        launchIds: string[];
        abonementAmount: number;
        perAsset: { assetName: string; count: number; amount: number }[];
      }
    >();
    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      if (!isStaysZone(zone) && !isLaunchesZone(zone)) continue;
      const boundary = boundaryByZone.get(zone.id) ?? null;
      const [agg, perAssetBreakdown] = await Promise.all([
        aggregateGameRoomLaunches(zone.id, boundary, now, tx),
        gameRoomRevenueByAsset(zone.id, boundary, now, tx),
      ]);
      const assetNameById = new Map(zone.assets.map((a) => [a.id, a.name]));
      const perAsset = perAssetBreakdown
        .map((a) => ({ assetName: assetNameById.get(a.assetId) ?? "", count: a.count, amount: a.calculatedAmount }))
        .sort((a, b) => b.count - a.count);
      gameRoomAggregateByZone.set(zone.id, {
        calculatedRevenue: agg.totalAmount,
        count: agg.count,
        totalMinutes: agg.totalMinutes,
        launchIds: agg.launchIds,
        perAsset,
        abonementAmount: agg.abonementAmount,
      });
    }

    // "Счётчики" и "Только касса" — оплата балансом (docs/spec/01-counters.md,
    // запрос пользователя 2026-07-20: "актуально не только для счётчиков, но и
    // Только касса") — те же "с прошлой сдачи" границы, что у Пусков/Прибываний
    // выше, но источник другой: у этих режимов нет Launch, только
    // MoneyOperation(type: "revenue_abonement") на зоне (см.
    // getZoneAbonementSpendAmount) — у "Только касса" нет даже активов, поэтому
    // считаем по зоне напрямую, не через AbonementTransaction.assetId.
    const counterAbonementByZone = new Map<string, number>();
    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      if (zone.accountingMode !== "counters" && zone.accountingMode !== "cash_only") continue;
      const boundary = boundaryByZone.get(zone.id) ?? null;
      counterAbonementByZone.set(zone.id, await getZoneAbonementSpendAmount(zone.id, boundary, tx));
    }

    // Билеты (docs/spec/10-tickets.md, "ДЕНЬГИ И СДАЧА ИТОГОВ") — та же схема
    // "с момента предыдущей сдачи", что у Пусков/Прибываний выше, просто
    // источник другой (TicketOrder/Ticket, не Launch). Расчётная выручка = сумма
    // НЕ voided Ticket.priceSnapshot окна — считается заранее (async), не в
    // синхронном .map() ниже.
    const ticketsAggregateByZone = new Map<string, Awaited<ReturnType<typeof aggregateTicketOrders>>>();
    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      if (!isTicketsZone(zone)) continue;
      const boundary = boundaryByZone.get(zone.id) ?? null;
      ticketsAggregateByZone.set(zone.id, await aggregateTicketOrders(zone.id, boundary, now, tx));
    }

    // Возвраты/тестовые пуски (docs/spec/01-counters.md, п.3) — запрос
    // пользователя 2026-07-24: раньше это было доверенное клиентское число
    // (returnsCount в payload), теперь единственный источник — журнал
    // ZoneReturnEvent (пункт нижнего бара "Счётчики"), та же граница "с
    // момента предыдущей сдачи", что у остальных агрегатов выше. Только
    // "counters" — у остальных режимов этого поля нет вовсе (см. комментарий
    // у ZoneSubmission.returnsCount ниже), Map просто не заполняется для них,
    // ?? 0 при чтении покрывает и это, и отсутствие записей.
    const returnsCountByZone = new Map<string, number>();
    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      if (zone.accountingMode !== "counters") continue;
      const boundary = boundaryByZone.get(zone.id) ?? null;
      // Tap-зоны (запрос пользователя 2026-07-25) — источник теперь
      // CounterTapEvent.voidedAt (привязан к конкретному тапу), ZoneReturnEvent
      // для них больше не используется вовсе (см. voidedCountByZoneTariff выше,
      // считает то же самое ПО ТАРИФУ для точного вычета в выручке; тут — сумма
      // по всем тарифам зоны, только для отображения общего числа).
      const count = isCountersTapAssistZone(zone)
        ? await tx.counterTapEvent.count({
            where: { zoneId: zone.id, createdAt: { gt: boundary ?? new Date(0), lte: now }, voidedAt: { not: null } },
          })
        : await tx.zoneReturnEvent.count({
            where: { zoneId: zone.id, createdAt: { gt: boundary ?? new Date(0), lte: now } },
          });
      returnsCountByZone.set(zone.id, count);
    }

    // Расходы (запрос пользователя 2026-07-25: "чтобы не надо было запоминать
    // до конца смены") — тот же принцип, что у Возвратов выше: единственный
    // источник — экран "Расходы", не доверенный клиентский payload. Применимо
    // к ЛЮБОМУ режиму учёта, не только "counters" — расход не завязан на
    // режим зоны.
    //
    // С 2026-08-15 расход УЖЕ операция журнала с момента ввода (см. schema.prisma
    // на месте удалённого ZoneExpenseEvent), поэтому сдача ничего не создаёт —
    // она только собирает ещё не привязанные строки зоны, чтобы ниже
    // проставить им свой resultsSubmissionId.
    //
    // Окно — ТЕКУЩИЙ бизнес-день, а не "всё непривязанное" (решение владельца
    // 2026-08-16). Одной непривязанности мало: расход, внесённый уже ПОСЛЕ
    // сдачи, остаётся ничьим до конца времён и раньше прилипал к следующей
    // сдаче — она прибавляла его к своей выручке (см. cashReceived ниже) и
    // показывала излишек в Разнице, хотя у сотрудника всё сошлось, а в Итогах
    // своего дня тот расход уже был учтён. Тот же эффект давали дни простоя:
    // "три дня дождя, потом сотрудник начал день с покупки тряпки" — расходы
    // непроработанных дней приклеились бы к первой же рабочей сдаче. Днём
    // ограничен и список расходов у сотрудника (api/operator/zone-expense-events),
    // так что сдача берёт ровно то, что он видел на экране.
    const businessDayStart = getBusinessDayBounds(tenantDayBoundary, now, tenantTimezone).start;
    const expenseOpsByZone = new Map<string, { id: string; amount: number }[]>();
    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      const ops = await tx.moneyOperation.findMany({
        where: {
          type: "expense",
          zoneId: zone.id,
          resultsSubmissionId: null,
          occurredAt: { gte: businessDayStart, lte: now },
        },
        select: { id: true, amount: true },
      });
      expenseOpsByZone.set(
        zone.id,
        ops.map((o) => ({ id: o.id, amount: Math.abs(Number(o.amount)) }))
      );
    }

    // Расходы, которые сотрудник внёс за этот период: он вводит в кассу
    // ОСТАТОК (деньги уже потрачены), поэтому для сверки со счётчиками их
    // возвращаем обратно — решение владельца 2026-08-16: «сотрудник не должен
    // ничего держать в голове».
    const expensesOf = (zoneId: string) =>
      (expenseOpsByZone.get(zoneId) ?? []).reduce((sum, e) => sum + e.amount, 0);

    const summary = zoneSubmissions.map((zs) => {
      const zone = zoneById.get(zs.zoneId)!;

      if (isStaysZone(zone) || isLaunchesZone(zone)) {
        const agg = gameRoomAggregateByZone.get(zone.id)!;
        const calculatedRevenue = agg.calculatedRevenue;
        const actualCash = zs.cashAmount + zs.mobileAmount;
        // abonementAmount вычитается из calculatedRevenue здесь — эта касса уже
        // получила эти деньги раньше, при пополнении абонемента, не сейчас
        // (реальный баг, найден пользователем 2026-07-18: без вычитания
        // разница ложно показывала недостачу ровно на сумму пусков,
        // оплаченных абонементом, каждый раз).
        const difference = Math.round((actualCash + expensesOf(zs.zoneId) + agg.abonementAmount - calculatedRevenue) * 100) / 100;
        return {
          zoneId: zs.zoneId,
          zoneName: zone.name,
          calculatedRevenue,
          actualCash,
          difference,
          readingsText: "",
          readingLines: [] as { assetName: string; tariffName: string; reading: number; delta: number }[],
          returnsCount: 0,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
          // Справочно, в кассу НЕ входит — уже получена раньше, при пополнении
          // абонемента (запрос пользователя 2026-07-17: "во всех отчётах и
          // сводках... правильные цифры", "добавить Абонемент").
          abonementAmount: agg.abonementAmount,
          gameRoomLaunchCount: agg.count,
          gameRoomTotalMinutes: agg.totalMinutes,
          perAsset: agg.perAsset,
          ticketsOrdersCount: null as number | null,
          ticketsCount: null as number | null,
          ticketsRedeemedCount: null as number | null,
          ticketsExpiredCount: null as number | null,
        };
      }

      if (isTicketsZone(zone)) {
        // Билеты (docs/spec/10-tickets.md, "ДЕНЬГИ И СДАЧА ИТОГОВ") — касса
        // ОДНОЙ ПАРОЙ ПОЛЕЙ на зону (не по активам, как у stays/launches выше —
        // заказ мультиактивный, физически деньги по активам не разложить,
        // осознанное расхождение). Способ оплаты заказа — справочная разбивка
        // (agg.cash/mobile/abonementAmount), НЕ автоподстановка — те же
        // zs.cashAmount/mobileAmount, что оператор ввёл вручную.
        const agg = ticketsAggregateByZone.get(zone.id)!;
        const calculatedRevenue = agg.totalAmount;
        const actualCash = zs.cashAmount + zs.mobileAmount;
        const difference = Math.round((actualCash + expensesOf(zs.zoneId) + agg.abonementAmount - calculatedRevenue) * 100) / 100;
        return {
          zoneId: zs.zoneId,
          zoneName: zone.name,
          calculatedRevenue,
          actualCash,
          difference,
          readingsText: "",
          readingLines: [] as { assetName: string; tariffName: string; reading: number; delta: number }[],
          returnsCount: 0,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
          abonementAmount: agg.abonementAmount,
          gameRoomLaunchCount: null as number | null,
          gameRoomTotalMinutes: null as number | null,
          perAsset: [] as { assetName: string; count: number; amount: number }[],
          ticketsOrdersCount: agg.ordersCount,
          ticketsCount: agg.ticketsCount,
          ticketsRedeemedCount: agg.redeemedCount,
          ticketsExpiredCount: agg.expiredCount,
        };
      }

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

      // "Счёт." — всегда валовая выручка по счётчикам, ФАКТ (запрос пользователя
      // 2026-07-16: "счётчики должны показывать всегда факт", без отдельной
      // строки "Валовая"). Разница — по-прежнему от net (за вычетом тестов):
      // это то число, по которому владелец реально принимает решение "сошлось/
      // не сошлось", и оно должно оставаться 0, когда тесты объясняют весь
      // разрыв, даже если "Счёт." теперь визуально не равен кассе.
      const calculatedRevenue = calcZoneGrossRevenue(tariffCalc);
      // Tap-зоны (запрос пользователя 2026-07-25) — точный вычет ПО ТАРИФУ из
      // voidedCountByZoneTariff вместо пропорционального calcZoneRevenue:
      // теперь известно, у какого именно тарифа случился возврат/тест (тап
      // привязан к конкретной записи), размазывать вычет по всем тарифам зоны
      // больше не нужно и было бы менее точно, чем то, что уже известно.
      const netRevenue = isCountersTapAssistZone(zone)
        ? calcZoneGrossRevenue(
            tariffCalc.map((tc) => ({
              ...tc,
              sessions: Math.max(tc.sessions - (voidedCountByZoneTariff.get(`${zone.id}:${tc.tariffId}`) ?? 0), 0),
            }))
          )
        : calcZoneRevenue(tariffCalc, returnsCountByZone.get(zone.id) ?? 0);
      const actualCash = zs.cashAmount + zs.mobileAmount;
      // Оплата балансом — вычитается из расчётной выручки перед сравнением с
      // кассой; какая именно часть, решает countersPaidFromBalance (там же
      // разобрано, почему у tap-зон и ручных "Счётчиков" разные источники).
      const counterAbonementAmount = counterAbonementByZone.get(zone.id) ?? 0;
      const paidFromBalance = countersPaidFromBalance(zone, {
        zoneSpend: counterAbonementAmount,
        tapLinked: tapAbonementAmountByZone.get(zone.id) ?? 0,
      });
      // "Только касса": "Расчётной выручки и разницы не существует — сравнивать
      // не с чем" (docs/spec/01-counters.md) — явно 0, а не actualCash−0 (аудит
      // 2026-07-25: без этой ветки Разница молча равнялась ВСЕЙ кассе зоны;
      // нигде в UI не показывается для cash_only, но лучше не оставлять
      // бессмысленное число в ответе API — тот же принцип, что уже применён в
      // /api/reports/counters/day/route.ts).
      const difference =
        zone.accountingMode === "cash_only"
          ? 0
          : Math.round((actualCash + expensesOf(zs.zoneId) - (netRevenue - paidFromBalance)) * 100) / 100;

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
        returnsCount: returnsCountByZone.get(zone.id) ?? 0,
        cashAmount: zs.cashAmount,
        mobileAmount: zs.mobileAmount,
        abonementAmount: counterAbonementAmount,
        gameRoomLaunchCount: null as number | null,
        gameRoomTotalMinutes: null as number | null,
        perAsset: [] as { assetName: string; count: number; amount: number }[],
        ticketsOrdersCount: null as number | null,
        ticketsCount: null as number | null,
        ticketsRedeemedCount: null as number | null,
        ticketsExpiredCount: null as number | null,
      };
    });

    // zoneId -> id только что созданной ZoneSubmission (реальный запрос
    // пользователя 2026-07-25: "сохранение id [Telegram-сообщения]... чтобы
    // такие ситуации можно было чинить") — нужен ПОСЛЕ транзакции, чтобы
    // привязать externalMessageId отправленной сводки к конкретной строке
    // (см. dispatchZoneSummary ниже), а после правки кассы через PATCH
    // .../zone-submission/[id] было что редактировать в Telegram.
    const zoneSubmissionIdByZone = new Map<string, string>();

    const created = await tx.resultsSubmission.create({
      data: { tenantId: point.tenantId, pointId: point.id, operatorId: operator.id, idempotencyKey },
    });

    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      const zoneSubmission = await tx.zoneSubmission.create({
        data: {
          resultsSubmissionId: created.id,
          zoneId: zs.zoneId,
          // У "Прибываний"/"Пусков"/"Билетов" нет поля "возвраты/тестовые" в
          // мастере (его роль выполняет аннулирование пуска/билета,
          // docs/spec/04-game-room.md, docs/spec/10-tickets.md) — Map просто
          // не заполняется для них, ?? 0 покрывает и это тоже.
          returnsCount: returnsCountByZone.get(zone.id) ?? 0,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
          // Тот же now, что использован как until для всех агрегатов выше
          // (аудит 2026-07-26) — раньше здесь был умолчательный @default(now())
          // самой БД, физически чуть позже now: любой пуск/тап, закрывшийся в
          // этом маленьком зазоре, не попадал НИ В ТЕКУЩУЮ, НИ В СЛЕДУЮЩУЮ
          // сдачу (until следующей = createdAt этой), выручка терялась
          // безвозвратно. Явный createdAt закрывает зазор до нуля.
          createdAt: now,
        },
      });
      zoneSubmissionIdByZone.set(zs.zoneId, zoneSubmission.id);

      // Ручные показания — только counters/launches-legacy без реального
      // учёта тапов; "Прибывания", "Пуски" и "Билеты" считаются исключительно
      // от Launch/TicketOrder (см. агрегаты выше), клиент их и не присылает,
      // но не доверяем этому тоже.
      if (!isStaysZone(zone) && !isLaunchesZone(zone) && !isTicketsZone(zone)) {
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
      }

      // Привязываем агрегированные пуски к этой сдаче (docs/spec/04-game-room.md) —
      // и как метка "уже учтён" для следующего окна агрегации, и как источник
      // производного calculatedRevenue на чтение (в ZoneSubmission он не
      // хранится отдельно, как и у counters/launches).
      if (isStaysZone(zone) || isLaunchesZone(zone)) {
        const agg = gameRoomAggregateByZone.get(zone.id);
        if (agg && agg.launchIds.length > 0) {
          // zoneSubmissionId:null в where — CAS (тот же приём, что
          // nextLaunchNumber/voidTicketInTx): launchIds посчитаны ДО этой
          // транзакции (previousSubmissionBoundary — обычный SELECT вне tx),
          // поэтому две параллельные сдачи по одной зоне могли посчитать
          // одинаковый список пусков. Без этого условия транзакция,
          // закоммитившаяся второй, молча переподписала бы уже занятые
          // пуски на себя, задваивая их расчётную выручку и обнуляя её у
          // проигравшей сдачи (аудит 2026-07-24). С условием — второй
          // updateMany затронет 0 строк для уже занятых пусков вместо их
          // перезаписи.
          await tx.launch.updateMany({
            where: { id: { in: agg.launchIds }, zoneSubmissionId: null },
            data: { zoneSubmissionId: zoneSubmission.id },
          });
        }
      }

      // Расходы — операции журнала, созданные Сотрудником на экране "Расходы"
      // ещё до сдачи (см. expenseOpsByZone выше), не клиентский payload
      // (запрос пользователя 2026-07-25). Сдача их не создаёт, а закрывает:
      // проставляет свою ссылку, после чего они уходят с экрана Сотрудника и
      // становятся неудаляемыми им.
      //
      // resultsSubmissionId: null в where — тот же CAS, что у пусков выше:
      // список собран ДО транзакции, и параллельная сдача по той же зоне
      // могла увидеть те же строки. Проигравшая просто затронет 0 строк
      // вместо того, чтобы переподписать чужой расход на себя.
      const zoneExpenseOps = expenseOpsByZone.get(zs.zoneId) ?? [];
      if (zoneExpenseOps.length > 0) {
        await tx.moneyOperation.updateMany({
          where: { id: { in: zoneExpenseOps.map((o) => o.id) }, resultsSubmissionId: null },
          data: { resultsSubmissionId: created.id },
        });
      }

      // В журнал идёт ПОЛУЧЕННАЯ выручка, а не введённый остаток: сотрудник
      // вводит то, что осталось в кассе после своих трат (решение владельца
      // 2026-08-16), значит потраченное нужно вернуть обратно — иначе расход
      // вычитается дважды, внутри введённой суммы и операцией расхода, и
      // остаток зоны занижается на его сумму.
      //
      // Проверяется на цифрах: получил 1000, купил на 350, ввёл 650.
      // revenue 1000 − expense 350 = 650 в кассе ✓. Без прибавки было бы
      // revenue 650 − 350 = 300, то есть на 350 меньше, чем в ящике.
      const cashReceived = Math.round((zs.cashAmount + expensesOf(zs.zoneId)) * 100) / 100;
      if (cashReceived > 0) {
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: zs.zoneId,
            type: "revenue",
            amount: cashReceived,
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

    return { created, summary, zoneSubmissionIdByZone };
  }

  let txResult: Awaited<ReturnType<typeof runSubmission>>;
  try {
    // timeout выше дефолтных 5с Prisma (запрос пользователя не звучал, но
    // необходимо технически) — транзакция теперь делает ВСЮ агрегацию, а не
    // только запись, несколько зон в одной сдаче суммарно легко превысят
    // дефолт под нагрузкой, приводя к спонтанным отказам без денежной
    // причины. maxWait тоже поднят (аудит 2026-07-26, самопроверка) — теперь
    // транзакция может реально ЖДАТЬ advisory-лок занятой зоны до её же
    // timeout, а не только исполняться; дефолтные 2с ожидания свободного
    // соединения были рассчитаны на короткую transaction-только-запись,
    // которой раньше был этот код.
    txResult = await prisma.$transaction(runSubmission, { timeout: 20000, maxWait: 20000 });
  } catch (err) {
    // Остаточная гонка на idempotencyKey (аудит 2026-07-25) — findUnique
    // выше это только быстрый оптимистичный отказ; два ПОЧТИ одновременных
    // запроса с одним и тем же ключом (маловероятно при последовательных
    // ретраях, но теоретически возможно) оба могли пройти его и упереться
    // в @@unique уже здесь, в самой записи. Тот же результат, что и обычное
    // повторное попадание — не задваиваем.
    if (err instanceof OpenLaunchesRaceError) {
      return NextResponse.json(
        { error: `Заверши ${err.openCount} активных пуск${err.openCount === 1 ? "" : "ов"} в зоне «${err.zoneName}»` },
        { status: 400 }
      );
    }
    if (idempotencyKey && err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      const existing = await prisma.resultsSubmission.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return NextResponse.json({ id: existing.id, summary: [], remindMarkDeparture: false, alreadyProcessed: true });
      }
    }
    throw err;
  }
  const submission = txResult.created;
  const summary = txResult.summary;
  const zoneSubmissionIdByZone = txResult.zoneSubmissionIdByZone;

  // Гасим накопленный "Аванс инкассации" сразу же, а не ждём следующей
  // инкассации (запрос пользователя 2026-07-25: "почему не вычесть эти 700 и
  // остаток оставить в зонах, чтобы я видел реальные цифры и авансовая
  // инкассация гасилась") — как только Сотрудник сдал итоги, свежая выручка
  // зон уже реальна, ждать отдельного нажатия "Инкассация" незачем. Функция
  // сама ничего не делает, если аванса нет (outstanding <= 0) — безопасно
  // вызывать после каждой сдачи, даже когда гасить нечего.
  // submission.id передан явно (аудит 2026-07-27) — привязывает автопогашение
  // к этой сдаче, чтобы её последующее удаление/правка (владельцем, пока она
  // ещё последняя в цепочке) могли откатить и его тоже — см. комментарий у
  // settleOutstandingCollectionAdvance.
  await settleOutstandingCollectionAdvance(point.tenantId, point.id, { performedByOperatorId: operator.id }, submission.id);

  // "Сводка по зоне" (docs/spec/telegram-summaries.md) — одна сводка на каждую
  // выбранную зону, не одно сообщение на всю сдачу (замена старой единой
  // Telegram-сводки submit-results — см. Шаг 0, решение о платформенном боте).
  const zoneSummarySettings =
    (await prisma.zoneSummarySettings.findUnique({ where: { tenantId: point.tenantId } })) ?? ZONE_SUMMARY_DEFAULTS;
  if (zoneSummarySettings.enabled) {
    // Одна сдача может закрывать сразу несколько зон — отправляем сводки
    // последовательно (await внутри своего же async IIFE, не блокируя ответ
    // оператору), а не все разом: параллельные sendChatMessage в один и тот
    // же Telegram-чат упирались в его rate-limit (~1 сообщение/сек), и
    // сообщение, отправленное последним, получало 429 и терялось без повтора
    // (реальный баг 2026-07-15 — "Машинки" пропали из сводки, хотя в БД
    // записались, потому что запись в БД идёт отдельной атомарной транзакцией
    // до этого блока).
    (async () => {
      for (const s of summary) {
        const zone = zoneById.get(s.zoneId)!;
        try {
          const results = await dispatchZoneSummary(
            point.tenantId,
            {
              pointName: point.name,
              zoneName: s.zoneName,
              zoneEmoji: zone.telegramEmoji,
              accountingMode: zone.accountingMode as ZoneAccountingMode,
              isGameRoom: isStaysZone(zone),
              gameRoomLaunchCount: s.gameRoomLaunchCount,
              gameRoomTotalMinutes: s.gameRoomTotalMinutes,
              occurredAt: submission.submittedAt,
              readings: s.readingLines,
              perAsset: s.perAsset,
              ticketsOrdersCount: s.ticketsOrdersCount,
              ticketsCount: s.ticketsCount,
              cashAmount: s.cashAmount,
              mobileAmount: s.mobileAmount,
              abonementAmount: s.abonementAmount,
              calculatedRevenue: s.calculatedRevenue,
              difference: s.difference,
              returnsCount: s.returnsCount,
              operatorName: operator.name,
              operatorColorTag: operator.colorTag,
            },
            zoneSummarySettings
          );
          // Запрос пользователя 2026-07-25: сохраняем id отправленного
          // Telegram-сообщения на саму ZoneSubmission — понадобится, если
          // Владелец позже поправит кассу через PATCH .../zone-submission/[id]
          // (тогда сводку можно отредактировать задним числом, а не оставлять
          // её с устаревшими цифрами навсегда).
          const telegramResult = results.find((r) => r.channelType === "telegram" && r.ok);
          const zoneSubmissionId = zoneSubmissionIdByZone.get(s.zoneId);
          if (telegramResult?.externalMessageId && zoneSubmissionId) {
            await prisma.zoneSubmission
              .update({
                where: { id: zoneSubmissionId },
                data: { telegramSummaryMessageId: telegramResult.externalMessageId },
              })
              .catch(() => {});
          }
        } catch (err) {
          console.error("zone summary dispatch failed", err);
        }
      }

      // "Касса за день" — ПОСЛЕ всех зонных сводок, внутри того же IIFE
      // (обратная связь пользователя 2026-08-04, скриншот: КАССА пришла между
      // "Батутами" и "Виртуалкой"). Раньше этот вызов стоял снаружи и
      // запускался ПАРАЛЛЕЛЬНО циклу: цикл шлёт зоны последовательно, с
      // паузами под рейт-лимит Telegram (~1 сообщение/сек, см. комментарий
      // выше), а триггер кассы успевал обогнать его и вклиниться в середину.
      // Данные при этом были верные — итог уже включал все зоны, — но читать
      // ленту, где общий итог стоит перед последней зоной, невозможно.
      await onResultsSubmission(point.id, point.tenantId, submission.submittedAt).catch((err) =>
        console.error("daily cash trigger failed", err)
      );
    })();
  } else {
    // Зонные сводки выключены — ждать нечего, шлём кассу сразу.
    onResultsSubmission(point.id, point.tenantId, submission.submittedAt).catch((err) =>
      console.error("daily cash trigger failed", err)
    );
  }

  // Мягкое напоминание (docs/spec/05-work-time.md, "СВЯЗЬ СО СДАЧЕЙ ИТОГОВ") —
  // после сдачи итогов, если сегодня ещё не отмечен уход (нет смены с
  // startAt сегодня — сама смена вводится целиком, "уход" не отдельное
  // событие, поэтому это буквально "смена сегодня ещё не введена").
  // Часовой пояс тенанта, не сырой UTC сервера (аудит 2026-07-25, финальный
  // проход, тот же класс бага, что уже чинили в lib/business-day.ts/
  // lib/reports.ts) — мягкое напоминание, не блокирует ничего, но могло
  // ложно срабатывать/не срабатывать около полуночи для тенанта не в UTC.
  const { start: dayStart, end: dayEnd } = getBusinessDayBounds(tenantDayBoundary, new Date(), tenantTimezone);
  const todayShift = await prisma.shift.findFirst({
    where: { operatorId: operator.id, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const remindMarkDeparture = !todayShift;

  return NextResponse.json({ id: submission.id, summary, remindMarkDeparture });
}
