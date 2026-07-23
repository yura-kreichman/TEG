import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  calcSessions,
  calcZoneGrossRevenue,
  calcZoneRevenue,
  isLaunchesZone,
  isStaysZone,
  isTicketsZone,
  type ZoneAccountingMode,
} from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { getZoneAbonementSpendAmount } from "@/lib/abonement";
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
import { localDateParts, zonedWallTimeToUtc } from "@/lib/business-day";

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
  categoryId?: string | null;
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
    include: { tariffs: { where: { deletedAt: null } }, assets: { orderBy: { sortOrder: "asc" } } },
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
  // число сеансов), returnsCount/cashAmount/mobileAmount — конечные
  // неотрицательные числа (отрицательный returnsCount у calcZoneRevenue
  // делал бы расчётную чистую выручку БОЛЬШЕ валовой). Клиентский визард и
  // так ограничивает ввод, но это только UI — прямой вызов API (в т.ч.
  // испорченный офлайн-payload) их не видел.
  for (const zs of zoneSubmissions) {
    if (
      !Number.isFinite(zs.returnsCount) ||
      zs.returnsCount < 0 ||
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
  // обхода. Проверяем ДО тяжёлого расчёта ниже, чтобы не тратить его впустую.
  for (const zs of zoneSubmissions) {
    const zone = zoneById.get(zs.zoneId)!;
    if (!isStaysZone(zone)) continue;
    const openCount = await countOpenLaunchesInZone(zone.id);
    if (openCount > 0) {
      return NextResponse.json(
        { error: `Заверши ${openCount} активных пуск${openCount === 1 ? "" : "ов"} в зоне «${zone.name}»` },
        { status: 400 }
      );
    }
  }

  // Категория расхода — не доверяем сырому categoryId от клиента, только
  // сверенный список категорий этого тенанта (иначе можно было бы подсунуть
  // чужой id и получить FK-ошибку транзакции целиком).
  const validCategoryIds = new Set(
    (await prisma.expenseCategory.findMany({ where: { tenantId: point.tenantId }, select: { id: true } })).map(
      (c) => c.id
    )
  );

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
  // заполнены) взаимоисключающи по зоне, так что смешения не бывает;
  // totalMinutes у "Пусков" всегда 0 (тап мгновенный, startedAt=endedAt) и
  // просто не используется дальше.
  const now = new Date();
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
    const boundary = await previousSubmissionBoundary(zone.id);
    const [agg, perAssetBreakdown] = await Promise.all([
      aggregateGameRoomLaunches(zone.id, boundary, now),
      gameRoomRevenueByAsset(zone.id, boundary, now),
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
    const boundary = await previousSubmissionBoundary(zone.id);
    counterAbonementByZone.set(zone.id, await getZoneAbonementSpendAmount(zone.id, boundary));
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
    const boundary = await previousSubmissionBoundary(zone.id);
    ticketsAggregateByZone.set(zone.id, await aggregateTicketOrders(zone.id, boundary, now));
  }

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
      const difference = Math.round((actualCash + agg.abonementAmount - calculatedRevenue) * 100) / 100;
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
      const difference = Math.round((actualCash + agg.abonementAmount - calculatedRevenue) * 100) / 100;
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
    const netRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
    const actualCash = zs.cashAmount + zs.mobileAmount;
    // Оплата балансом (docs/spec/01-counters.md, запрос пользователя
    // 2026-07-20) — та же поправка, что у Пусков/Прибываний: касса уже
    // получила эти деньги раньше, при пополнении абонемента, не сейчас.
    const counterAbonementAmount = counterAbonementByZone.get(zone.id) ?? 0;
    const difference = Math.round((actualCash + counterAbonementAmount - netRevenue) * 100) / 100;

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

  let submission;
  try {
    submission = await prisma.$transaction(async (tx) => {
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
          // docs/spec/04-game-room.md, docs/spec/10-tickets.md) — не доверяем
          // тому, что мог прислать клиент.
          returnsCount: isStaysZone(zone) || isLaunchesZone(zone) || isTicketsZone(zone) ? 0 : zs.returnsCount,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
        },
      });

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

      const zoneExpenses = expenses.filter((e) => e.zoneId === zs.zoneId);
      for (const expense of zoneExpenses) {
        const categoryId =
          expense.categoryId && validCategoryIds.has(expense.categoryId) ? expense.categoryId : null;
        await tx.expenseEntry.create({
          data: {
            zoneSubmissionId: zoneSubmission.id,
            categoryId,
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
  } catch (err) {
    // Остаточная гонка на idempotencyKey (аудит 2026-07-25) — findUnique
    // выше это только быстрый оптимистичный отказ; два ПОЧТИ одновременных
    // запроса с одним и тем же ключом (маловероятно при последовательных
    // ретраях, но теоретически возможно) оба могли пройти его и упереться
    // в @@unique уже здесь, в самой записи. Тот же результат, что и обычное
    // повторное попадание — не задваиваем.
    if (idempotencyKey && err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      const existing = await prisma.resultsSubmission.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return NextResponse.json({ id: existing.id, summary: [], remindMarkDeparture: false, alreadyProcessed: true });
      }
    }
    throw err;
  }

  // Гасим накопленный "Аванс инкассации" сразу же, а не ждём следующей
  // инкассации (запрос пользователя 2026-07-25: "почему не вычесть эти 700 и
  // остаток оставить в зонах, чтобы я видел реальные цифры и авансовая
  // инкассация гасилась") — как только Сотрудник сдал итоги, свежая выручка
  // зон уже реальна, ждать отдельного нажатия "Инкассация" незачем. Функция
  // сама ничего не делает, если аванса нет (outstanding <= 0) — безопасно
  // вызывать после каждой сдачи, даже когда гасить нечего.
  await settleOutstandingCollectionAdvance(point.tenantId, point.id, { performedByOperatorId: operator.id });

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
          await dispatchZoneSummary(
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
        } catch (err) {
          console.error("zone summary dispatch failed", err);
        }
      }
    })();
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
  // Часовой пояс тенанта, не сырой UTC сервера (аудит 2026-07-25, финальный
  // проход, тот же класс бага, что уже чинили в lib/business-day.ts/
  // lib/reports.ts) — мягкое напоминание, не блокирует ничего, но могло
  // ложно срабатывать/не срабатывать около полуночи для тенанта не в UTC.
  const tenantForTz = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { timezone: true } });
  const timezone = tenantForTz?.timezone ?? "UTC";
  const nowLocal = localDateParts(new Date(), timezone);
  const dayStart = zonedWallTimeToUtc(nowLocal.year, nowLocal.month, nowLocal.day, 0, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const todayShift = await prisma.shift.findFirst({
    where: { operatorId: operator.id, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const remindMarkDeparture = !todayShift;

  return NextResponse.json({ id: submission.id, summary, remindMarkDeparture });
}
