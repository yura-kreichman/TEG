import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { isModuleEnabled } from "@/lib/tenant-modules";
import {
  getChangeFundInTillByZone,
  getPointAbonementCashTotal,
  getPointGoodsCashTotal,
  getZoneCollectionOverdraw,
} from "@/lib/zone-balance";
import {
  allocateAdvanceToZones,
  getCollectionAdvanceTakenSince,
  getPendingCashRevenueByZone,
} from "@/lib/pending-revenue";
import { previousSubmissionBoundary } from "@/lib/game-room";
import { getExpenseCompensation } from "@/lib/expense-compensation";
import { getBusinessDayBounds } from "@/lib/business-day";
import { getTenantDayContext } from "@/lib/tenant-day";

export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { operator, point } = ctx;

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    include: {
      // options — тариф "Пусков" может нести варианты длительность+цена, та
      // же механика "За вход", что у "Прибываний" (запрос пользователя
      // 2026-07-28); у counters/cash_only/tickets тарифов с опциями не
      // бывает, пустой массив там не мешает.
      tariffs: {
        where: { deletedAt: null },
        orderBy: { order: "asc" as const },
        include: { options: { orderBy: { order: "asc" as const } } },
      },
      assets: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  // Previous reading per (assetId, tariffId): the latest AssetReading recorded
  // across any past submission, regardless of date — "расчёт всегда от
  // предыдущей сдачи" (docs/spec/01-counters.md). Only meaningful in "counters"
  // mode — "launches" readings aren't a running meter, so there's nothing to
  // look up (previousReadings stays all-zero for those zones).
  const assetIds = zones
    .filter((z) => z.accountingMode === "counters")
    .flatMap((z) => z.assets.map((a) => a.id));
  const previousReadings = assetIds.length
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: assetIds } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const previousByKey = new Map<string, number>();
  for (const reading of previousReadings) {
    const key = `${reading.assetId}:${reading.tariffId}`;
    if (!previousByKey.has(key)) previousByKey.set(key, reading.reading);
  }
  const initialByKey = await getInitialReadingsMap(assetIds);

  // "Прибывания" — тариф+варианты актива для экрана оператора (запрос
  // пользователя 2026-07-17: "1 час, 2 часа..." — оператор выбирает вариант
  // при старте пуска). Один запрос на все stays-зоны разом, не по одному на
  // актив.
  const staysTariffIds = zones
    .filter((z) => z.accountingMode === "stays")
    .flatMap((z) => z.assets.map((a) => a.tariffId).filter((tid): tid is string => !!tid));
  const staysTariffs = staysTariffIds.length
    ? await prisma.tariff.findMany({
        where: { id: { in: staysTariffIds }, deletedAt: null },
        include: { options: { orderBy: { order: "asc" } } },
      })
    : [];
  const staysTariffById = new Map(staysTariffs.map((t) => [t.id, t]));

  // Билеты (docs/spec/10-tickets.md) — варианты цен активов для экрана
  // "Продать" (PWA оператора), тот же принцип, что staysTariffs выше: один
  // запрос на все tickets-зоны разом.
  const ticketAssetIds = zones
    .filter((z) => z.accountingMode === "tickets")
    .flatMap((z) => z.assets.map((a) => a.id));
  const ticketVariants = ticketAssetIds.length
    ? await prisma.ticketVariant.findMany({
        where: { assetId: { in: ticketAssetIds }, deletedAt: null },
        orderBy: { order: "asc" },
      })
    : [];
  const ticketVariantsByAsset = new Map<string, typeof ticketVariants>();
  for (const v of ticketVariants) {
    if (!ticketVariantsByAsset.has(v.assetId)) ticketVariantsByAsset.set(v.assetId, []);
    ticketVariantsByAsset.get(v.assetId)!.push(v);
  }

  // Категории расходов тенанта (запрос пользователя 2026-07-14) — для выбора
  // при вводе расхода на шаге "Расходы" мастера сдачи итогов.
  const expenseCategories = await prisma.expenseCategory.findMany({
    where: { tenantId: point.tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  // Размен, внесённый владельцем в кассу зоны с прошлой сдачи итогов (разбор
  // с владельцем Игроленда 2026-09-02). Эти деньги физически лежат в ящике,
  // но выручкой не являются — сотрудник, пересчитывая ящик, включает их в
  // сумму, и без явного вычитания «Разница» показывает ложный излишек.
  //
  // Формула сверки НЕ меняется (решение того же дня): вместо тихой
  // арифметики мастер показывает вычитание сотруднику и отправляет уже
  // очищенную выручку. Задним числом ничего не пересчитывается — из базы
  // невозможно узнать, пересчитывал сотрудник весь ящик или только выручку.
  //
  // Считает КАНОНИЧЕСКАЯ функция, а не своё окно (генеральная проверка
  // финансов 2026-09-02, С17). Здесь была вторая, независимая отсечка — «всё,
  // что внесено после прошлой сдачи итогов», — и она отвечала на другой
  // вопрос, чем касса: размен привязан к промежутку между ИНКАССАЦИЯМИ, а не
  // между сдачами. Внесённый вчера и уже вычтенный вчерашней сдачей размен
  // сегодня в это окно не попадал, зато оставался в кассе — и одни и те же
  // деньги вычитались дважды, через день.
  // Невнесённая наличная выручка по зонам — ею обрезка размена меряет ящик,
  // а не журнальный остаток (закрывающий аудит 2026-09-03, разбор — у
  // getPendingCashRevenueByZone). Оба живых экрана зовут ОДИН помощник:
  // формула в двух копиях тут уже расходилась.
  const changeFundByZone =
    zones.length > 0
      ? await getChangeFundInTillByZone(zones.map((z) => z.id))
      : new Map<string, number>();

  // Сколько владелец забрал из зоны инкассацией ДО пересчёта (жалоба владельца
  // КидсБурга 2026-09-02). Сотрудник этих денег в ящике уже не застаёт, а
  // сдача возвращает их в выручку — значит и предпросмотр «Разницы» в мастере
  // обязан их прибавлять, иначе сотрудник видит недостачу, а сервер считает
  // ноль. Разбор правила — у getZoneCollectionOverdraw.
  const boundaryByZone = new Map<string, Date | null>();
  for (const zone of zones) boundaryByZone.set(zone.id, await previousSubmissionBoundary(zone.id));
  const now = new Date();
  const rawOverdraw =
    zones.length > 0
      ? await getZoneCollectionOverdraw(
          zones.map((z) => z.id),
          boundaryByZone,
          now
        )
      : new Map<string, number>();
  // ЗА ВЫЧЕТОМ уже компенсированных расходов — ровно как на сервере сдачи
  // (закрывающий аудит 2026-09-03). Дефицит растёт от любой операции, что
  // уводит кассу в минус, включая расход, а расход мастер прибавляет к
  // «Разнице» отдельной строкой. Без вычета сотрудник видел бы излишек ровно
  // на сумму своих трат — и это ещё до отправки, то есть подгонял бы кассу.
  const { timezone: tz, boundary: dayBoundary } = await getTenantDayContext(point.tenantId);
  const businessDayStart = getBusinessDayBounds(dayBoundary, now, tz).start;
  const compensation = await getExpenseCompensation(point.id, businessDayStart, now);
  // Плюс забранное ОБЩЕЙ инкассацией по точке — тем же помощником, что и на
  // сервере сдачи (решение владельца 2026-09-03). Иначе мастер показал бы
  // сотруднику недостачу, которой сервер не увидит, и сотрудник подгонял бы
  // кассу под неё — та же беда, что уже была с расходами.
  const zoneBoundaries = zones.map((z) => boundaryByZone.get(z.id) ?? null);
  const earliestBoundary = zoneBoundaries.some((b) => b === null)
    ? null
    : zoneBoundaries.length > 0
      ? new Date(Math.min(...zoneBoundaries.map((b) => b!.getTime())))
      : null;
  const advanceByZone = allocateAdvanceToZones(
    await getCollectionAdvanceTakenSince(point.id, earliestBoundary, now),
    zones.map((z) => z.id),
    await getPendingCashRevenueByZone(zones, now)
  );
  const collectedBeforeByZone = new Map<string, number>();
  for (const zone of zones) {
    const raw = rawOverdraw.get(zone.id) ?? 0;
    const compensated = compensation.compensatedByZone.get(zone.id) ?? 0;
    const net = Math.max(0, Math.round((raw - compensated) * 100) / 100);
    const withAdvance = Math.round((net + (advanceByZone.get(zone.id) ?? 0)) * 100) / 100;
    if (withAdvance !== 0) collectedBeforeByZone.set(zone.id, withAdvance);
  }

  const result = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    iconKey: zone.iconKey,
    accountingMode: zone.accountingMode,
    // Ноль — самый частый случай (на всей платформе разменом пользуется один
    // тенант), и при нуле экран мастера не меняется вовсе.
    changeFundAmount: changeFundByZone.get(zone.id) ?? 0,
    // Обычно ноль: владелец забирает кассу после сдачи, а не до неё.
    collectedBeforeAmount: collectedBeforeByZone.get(zone.id) ?? 0,
    // Модуль печати (запрос пользователя 2026-07-20) — доступна ли кнопка
    // "Печать квитанции" оператору в этой зоне (stays/launches).
    printReceiptEnabled: zone.printReceiptEnabled,
    // Округление суммы "По факту" (запрос пользователя 2026-07-27) — только
    // "Прибывания"; нужен оператору для живого предпросмотра суммы на
    // тайле/в шторке "Способ оплаты" ДО стопа, чтобы не показывать
    // нерасхождённое число, которое сервер потом округлит на самом стопе.
    amountRoundingEnabled: zone.amountRoundingEnabled,
    // Билеты (docs/spec/10-tickets.md, "ДОСТУП К СДАЧЕ") — оператор БЕЗ
    // тумблера "Продажа билетов" всё ещё гасит билеты (см. /api/tickets/
    // [id]/redeem, доступ там проверяется отдельно, по allowedZones), но
    // зону режима tickets в МАСТЕРЕ СДАЧИ ИТОГОВ видеть не должен — этот
    // эндпоинт общий (его же используют экраны Прибываний/Пусков для нав.
    // видимости), поэтому саму зону из списка не убираем — только
    // отмечаем флагом, мастер сдачи фильтрует по нему сам (не переиспользуем
    // логику Товаров — та зон в мастере не касалась вовсе, см. обсуждение
    // на этапе ревью спеки).
    ticketsSubmissionAllowed: zone.accountingMode !== "tickets" || operator.ticketsAccess,
    // "Счётчики" с тапами вместо ручного ввода показаний (запрос пользователя
    // 2026-07-25) — мастер сдачи итогов для такой зоны пропускает шаг
    // показаний так же, как уже делает для launches/stays/tickets/cash_only
    // (см. operator/submit/page.tsx), только у ЭТОЙ зоны accountingMode
    // остаётся "counters" — различать нужно ИМЕННО по этому флагу, не по
    // режиму.
    countersTapAssistEnabled: zone.countersTapAssistEnabled,
    ...(zone.accountingMode === "tickets"
      ? { ticketRedemptionEnabled: zone.ticketRedemptionEnabled, ticketLifetimeDays: zone.ticketLifetimeDays }
      : {}),
    tariffs: zone.tariffs.map((t) => ({
      id: t.id,
      name: t.name,
      price: t.price,
      order: t.order,
      // Только "Пуски" — тариф с таймером (запрос пользователя 2026-07-28),
      // null у обычных тарифов counters/launches/cash_only/tickets.
      pricingMode: t.pricingMode,
      options: t.options.map((o) => ({ id: o.id, name: o.name, durationMinutes: o.durationMinutes, price: Number(o.price) })),
    })),
    assets: zone.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      colorTag: asset.colorTag,
      photoUrl: asset.photoUrl,
      iconKey: asset.iconKey,
      // Деактивированный актив (на ремонте) остаётся видимым оператору, но
      // read-only — в отличие от Zone.active, который скрывает зону целиком
      // (запрос пользователя 2026-07-16).
      active: asset.active,
      previousReadings: Object.fromEntries(
        zone.tariffs.map((t) => {
          const key = `${asset.id}:${t.id}`;
          return [t.id, previousByKey.get(key) ?? initialByKey.get(key) ?? 0];
        })
      ),
      ...(zone.accountingMode === "stays"
        ? {
            tariff: (() => {
              const tf = asset.tariffId ? staysTariffById.get(asset.tariffId) : null;
              if (!tf) return null;
              return {
                pricingMode: tf.pricingMode,
                options: tf.options.map((o) => ({
                  id: o.id,
                  durationMinutes: o.durationMinutes,
                  price: Number(o.price),
                  name: o.name,
                })),
              };
            })(),
          }
        : {}),
      ...(zone.accountingMode === "tickets"
        ? {
            ticketVariants: (ticketVariantsByAsset.get(asset.id) ?? []).map((v) => ({
              id: v.id,
              name: v.name,
              price: Number(v.price),
            })),
          }
        : {}),
    })),
  }));

  // Остатки Абонементов/Товаров наличными — для дропдауна выбора цели
  // инкассации (запрос пользователя 2026-07-25: "если нет денег в
  // абонементах и товарах, они вообще не должны отображаться в dropdown" —
  // те же цифры, что owner-версия берёт из /api/reports/money).
  // Настройки → Система → "Расходы" (запрос пользователя 2026-07-25) — НЕ
  // часть плашки "Модули" (tenant-modules.ts), простой булев тумблер, тот же
  // паттерн, что goodsAllowBalancePayment/printingEnabled. Гейтит и кнопку
  // на Главной, и сам шаг "Расходы" в мастере сдачи итогов.
  const [abonementCashTotal, goodsCashTotal, tenantFlags] = await Promise.all([
    getPointAbonementCashTotal(point.id),
    getPointGoodsCashTotal(point.id),
    prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { expensesEnabled: true } }),
  ]);

  return NextResponse.json({
    operatorName: operator.name,
    pointName: point.name,
    zones: result,
    expenseCategories,
    goodsAccess: operator.goodsAccess,
    ticketsAccess: operator.ticketsAccess,
    // Видит ли сотрудник "Разницу" живьём при вводе кассы (см. комментарий у
    // Operator.showDifferenceOnSubmit в schema.prisma). Выключено — слепой
    // ввод: разница появляется только на экране "Принято", после отправки.
    showDifferenceOnSubmit: operator.showDifferenceOnSubmit,
    // Настройки → Система → "Модули" (запрос пользователя 2026-07-22) —
    // гейтит видимость пункта "Клиенты" в нижнем баре (operator-bottom-nav.tsx),
    // тот же принцип, что goodsAccess выше.
    clientsEnabled: await isModuleEnabled(point.tenantId, "clientsEnabled"),
    expensesEnabled: tenantFlags?.expensesEnabled ?? true,
    abonementCashTotal: Math.round(abonementCashTotal * 100) / 100,
    goodsCashTotal: Math.round(goodsCashTotal * 100) / 100,
  });
}
