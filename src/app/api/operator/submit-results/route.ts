import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import {
  calcSessions,
  calcZoneGrossRevenue,
  calcZoneRevenue,
  isLaunchesZone,
  isStaysZone,
  type ZoneAccountingMode,
} from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { aggregateGameRoomLaunches, countOpenLaunchesInZone, previousSubmissionBoundary } from "@/lib/game-room";
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

  if (!Array.isArray(zoneSubmissions) || zoneSubmissions.length === 0) {
    return NextResponse.json({ error: "Выберите хотя бы одну зону" }, { status: 400 });
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
    { calculatedRevenue: number; count: number; totalMinutes: number; launchIds: string[]; abonementAmount: number }
  >();
  for (const zs of zoneSubmissions) {
    const zone = zoneById.get(zs.zoneId)!;
    if (!isStaysZone(zone) && !isLaunchesZone(zone)) continue;
    const boundary = await previousSubmissionBoundary(zone.id);
    const agg = await aggregateGameRoomLaunches(zone.id, boundary, now);
    gameRoomAggregateByZone.set(zone.id, {
      calculatedRevenue: agg.totalAmount,
      count: agg.count,
      totalMinutes: agg.totalMinutes,
      launchIds: agg.launchIds,
      abonementAmount: agg.abonementAmount,
    });
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
    const difference = Math.round((actualCash - netRevenue) * 100) / 100;

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
      abonementAmount: 0, // Счётчики — абонемент как способ оплаты не применим (docs/spec/01-counters.md).
      gameRoomLaunchCount: null as number | null,
      gameRoomTotalMinutes: null as number | null,
    };
  });

  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.resultsSubmission.create({
      data: { tenantId: point.tenantId, pointId: point.id, operatorId: operator.id },
    });

    for (const zs of zoneSubmissions) {
      const zone = zoneById.get(zs.zoneId)!;
      const zoneSubmission = await tx.zoneSubmission.create({
        data: {
          resultsSubmissionId: created.id,
          zoneId: zs.zoneId,
          // У "Прибываний"/"Пусков" нет поля "возвраты/тестовые" в мастере
          // (его роль выполняет аннулирование пуска, docs/spec/04-game-room.md) —
          // не доверяем тому, что мог прислать клиент.
          returnsCount: isStaysZone(zone) || isLaunchesZone(zone) ? 0 : zs.returnsCount,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
        },
      });

      // Ручные показания — только counters/launches-legacy без реального
      // учёта тапов; "Прибывания" и "Пуски" считаются исключительно от
      // Launch (см. агрегат выше), клиент их и не присылает, но не доверяем
      // этому тоже.
      if (!isStaysZone(zone) && !isLaunchesZone(zone)) {
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
          await tx.launch.updateMany({
            where: { id: { in: agg.launchIds } },
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
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const todayShift = await prisma.shift.findFirst({
    where: { operatorId: operator.id, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const remindMarkDeparture = !todayShift;

  return NextResponse.json({ id: submission.id, summary, remindMarkDeparture });
}
