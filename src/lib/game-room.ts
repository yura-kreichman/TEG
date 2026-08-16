// Модуль "Прибывания" (docs/spec/04-game-room.md) — чистая расчётная
// логика и общие для бэкенд-роутов операции с пусками. Отдельно от
// results-calc.ts (тот — про counters/launches/cash_only/stays как режимы
// учёта), потому что расчёт здесь принципиально другой: не от показаний/
// введённого итога, а от агрегата реальных старт/стоп записей.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { PAYMENT_SPLIT_METHOD } from "@/lib/payment-split";

type Tx = Prisma.TransactionClient;

export const LAUNCH_PRICING_MODES = ["fixed", "per_minute"] as const;
export type LaunchPricingMode = (typeof LAUNCH_PRICING_MODES)[number];

export const LAUNCH_ROUNDING_MODES = ["up", "down", "nearest"] as const;
export type LaunchRoundingMode = (typeof LAUNCH_ROUNDING_MODES)[number];

// Способ оплаты — у "per_minute"/"По факту" спрашивается при остановке
// пуска, у "fixed"/"За вход" и "Пусков" сразу (запрос пользователя
// 2026-07-17). "abonement" (тот же день, отдельный запрос) — списание с
// кошелька клиента вместо наличных/безнала, требует Launch.abonementWalletId,
// см. src/lib/abonement.ts.
export const LAUNCH_PAYMENT_METHODS = ["cash", "mobile", "abonement"] as const;
export type LaunchPaymentMethod = (typeof LAUNCH_PAYMENT_METHODS)[number];

// Ограничение на число одновременно открытых пусков одного актива/зоны
// (docs/spec/04-game-room.md, Шаг 3: "лимит разумного числа параллельных на
// актив — предложи значение"). 50 — с запасом над реальным тестовым кейсом
// в 20 параллельных пусков (батутная арена), но не бесконечность: явная
// защита от зависшего клиента, который спамит старт без остановки.
export const MAX_PARALLEL_LAUNCHES = 50;

export interface LaunchPricingSnapshot {
  pricingMode: LaunchPricingMode;
  priceSnapshot: Prisma.Decimal | number;
  durationMinutesSnapshot: number | null;
  roundingModeSnapshot: LaunchRoundingMode | null;
  minAmountSnapshot: Prisma.Decimal | number | null;
}

/**
 * Действующий тариф АКТИВА — тариф ЗОНЫ (Tariff, та же сущность и тот же
 * лимит, что у counters/launches), на который ссылается Asset.tariffId
 * (запрос пользователя 2026-07-17: тарифы и активы создаются независимо,
 * владелец сам привязывает один к другому — было наоборот, Tariff.assetId,
 * пересмотрено). null, если у актива ещё не выбран тариф, или выбранный
 * тариф удалён (soft-delete).
 */
export async function getAssetTariff(assetId: string, tx: Tx | typeof prisma = prisma) {
  const asset = await tx.asset.findUnique({ where: { id: assetId }, select: { tariffId: true } });
  if (!asset?.tariffId) return null;
  return tx.tariff.findFirst({
    where: { id: asset.tariffId, deletedAt: null },
  });
}

/**
 * Наименьшее положительное целое, отсутствующее среди переданных — номер
 * браслета (запрос пользователя 2026-07-17: "если активные 1, 2, 3, то после
 * освобождения 2 следующему присваивается 2" — переиспользование, а не
 * бесконечный рост). Чистая функция, отдельно от БД-обёртки ниже — тестируется
 * без Prisma.
 */
export function smallestFreeNumber(usedNumbers: Iterable<number>): number {
  const used = new Set(usedNumbers);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * Номер браслета для следующего пуска — наименьший свободный СРЕДИ ОТКРЫТЫХ
 * пусков этого актива (запрос пользователя 2026-07-17: "отдельный пул
 * браслетов на каждый актив" — тот же номер вполне может быть одновременно
 * активен на другом активе). Атомарно через advisory-lock транзакции (не
 * через @@unique — Launch.assetId используется как lock key напрямую, без
 * зоны). Лок держится до конца транзакции tx и сам снимается коммитом/
 * роллбэком — вызывающий код обязан вызывать это внутри prisma.$transaction.
 */
export async function nextLaunchNumber(tx: Tx, assetId: string): Promise<number> {
  // $executeRaw, не $queryRaw — pg_advisory_xact_lock() возвращает void,
  // адаптер @prisma/adapter-pg падает при попытке десериализовать пустую
  // колонку через $queryRaw ("Failed to deserialize column of type 'void'",
  // реальная ошибка 2026-07-17 при первом живом старте пуска). Возврат не
  // нужен — важен только побочный эффект (лок до конца транзакции).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assetId}))`;
  const open = await tx.launch.findMany({
    where: { assetId, isOpen: true },
    select: { number: true },
  });
  return smallestFreeNumber(open.map((l) => l.number));
}

export async function countOpenLaunches(assetId: string, tx: Tx | typeof prisma = prisma) {
  return tx.launch.count({ where: { assetId, isOpen: true } });
}

/**
 * Зона доступна оператору для операций с пусками — та же проверка, что уже
 * используется для мастера сдачи итогов (submission-context/route.ts):
 * своя точка + (доступ ко всем зонам ИЛИ зона в allowedZones).
 */
export async function findOperatorStaysZone(
  zoneId: string,
  pointId: string,
  operator: { id: string; allZonesAccess: boolean }
) {
  return prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId,
      active: true,
      accountingMode: "stays",
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    include: { assets: true },
  });
}

/**
 * Зона доступна оператору для тапа пусков "Пуски" (accountingMode="launches",
 * запрос пользователя 2026-07-17: "тапали по активам и пуски учитывались" —
 * цифровая замена бумажной тетрадки с плюсиками). Та же проверка доступа,
 * что у findOperatorStaysZone — своя точка + (доступ ко всем зонам ИЛИ зона
 * в allowedZones). Тарифы зоны нужны сразу (до 2, оператор выбирает на
 * каждом пуске — тариф не привязан к активу заранее, в отличие от stays).
 */
export async function findOperatorLaunchesZone(
  zoneId: string,
  pointId: string,
  operator: { id: string; allZonesAccess: boolean }
) {
  return prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId,
      active: true,
      accountingMode: "launches",
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    include: {
      assets: true,
      // options — тариф "Пусков" может, как и "За вход" у "Прибываний", нести
      // варианты длительность+цена (запрос пользователя 2026-07-28: "10 руб.
      // за 10 минут, 15 руб. за 20 минут" — оператор выбирает вариант на
      // тапе, тайл актива живёт с обратным отсчётом). Тариф без вариантов
      // (pricingMode=null) продолжает работать как раньше — мгновенный тап.
      tariffs: {
        where: { deletedAt: null },
        orderBy: { order: "asc" },
        include: { options: { orderBy: { order: "asc" } } },
      },
    },
  });
}

/**
 * Для мягкой блокировки сдачи итогов — открытые пуски по всей зоне, любой
 * актив, ПЛЮС "заморожен, но не оплачен" (isOpen:false, paymentMethod:null,
 * см. /api/launches/[id]/lock, запрос пользователя 2026-07-27) — если
 * позволить сдачу пока такой пуск висит, граница следующей сдачи уйдёт за
 * его endedAt и его сумма никогда ни в один агрегат не попадёт (тот же
 * класс бага, что уже нашли на проде — Керен Центр, осиротевший пуск). В
 * норме таких долго не бывает — короткий тайм-аут (см. LAUNCH_LOCK_TIMEOUT_MS)
 * сам возвращает их в isOpen:true, если оператор не успел оплатить.
 */
export async function countOpenLaunchesInZone(zoneId: string, tx: Tx | typeof prisma = prisma) {
  return tx.launch.count({ where: { zoneId, OR: [{ isOpen: true }, { isOpen: false, paymentMethod: null }] } });
}

// Сколько "заморозка" (см. /api/launches/[id]/lock) держит сумму/время
// зафиксированными, пока оператор выбирает способ оплаты, прежде чем
// автоматически вернуть пуск в идущий (запрос пользователя 2026-07-27:
// сначала "показывать бессрочно", затем пересмотрено в тот же вечер —
// реальный риск злоупотребления, если держать бессрочно: Сотрудник мог бы
// зафиксировать заниженную сумму рано, физически не забирая браслет у
// ребёнка, и забрать разницу наличными мимо кассы. 30 секунд — с запасом
// хватает потыкать способ оплаты, но не оставляет практически
// эксплуатируемого окна (максимум украдкой "сэкономленного" — доля минуты
// тарифа).
export const LAUNCH_LOCK_TIMEOUT_MS = 30_000;

export interface ExpiredLaunchInfo {
  count: number;
  firstAssetId: string | null;
  // Куда вести оператора из глобального баннера — зависит от того, в зоне
  // какого режима найден первый просроченный пуск (запрос пользователя
  // 2026-07-28: та же таймерная механика "За вход" появилась и у "Пусков",
  // экраны у них разные — /operator/game-room и /operator/launches). null,
  // если просроченных нет вовсе.
  firstAssetZoneMode: "stays" | "launches" | null;
  // Первый (самый срочный) пуск уже реально просрочен (время <= 0), а не
  // просто приближается к концу — баннер показывает разный текст (запрос
  // пользователя 2026-07-28: "внизу сообщение 'Истекает таймер' даже если
  // таймер уже истёк" — нужно различать).
  firstIsExpired: boolean;
  // Название актива и зоны — баннер общий на ВСЮ точку, при двух
  // одновременно истекающих таймерах (один в "Прибываниях", другой в
  // "Пусках") было неясно, к какому активу и на какой экран идти (реальная
  // жалоба пользователя 2026-07-28); называем оба, не просто "перейти к
  // активу" — актив говорит, к чему подойти физически, зона — на какой
  // экран переключиться.
  firstAssetName: string | null;
  firstZoneName: string | null;
}

// Предупреждать не только когда время УЖЕ вышло, но и заранее, за 30 секунд
// до конца (запрос пользователя 2026-07-17: "не только те, где время уже
// вышло, а и те где до конца остаётся немного" — уточнено 2026-07-28: было
// 60 секунд, "предупреждение должно начинаться за 30 секунд") — оператор
// успевает подойти к активу заранее, а не только когда таймер уже красный.
const NEAR_EXPIRY_WINDOW_MS = 30000;

/**
 * Пуски "За вход" (pricingMode="fixed"), которым до конца остаётся
 * NEAR_EXPIRY_WINDOW_MS или меньше (включая уже просроченные), по ВСЕЙ
 * точке — не по одной выбранной зоне (запрос пользователя 2026-07-17: "не
 * хватает напоминания/звукового непрерывного уведомления... если ПОДОШЁЛ
 * ТАЙМЕР К КОНЦУ", независимо от того, на каком экране оператор сейчас
 * находится). Учитывает и "Прибывания", и "Пуски" (запрос пользователя
 * 2026-07-28) — у обоих одна и та же таймерная механика "fixed"+варианты
 * длительности. "По факту" не участвует — там нет длительности, значит нет
 * и истечения. firstAssetId — для перехода из глобального баннера сразу к
 * активу, тем же приёмом, что "Перейти к активу" в мастере сдачи итогов.
 */
export async function findExpiredFixedLaunches(
  pointId: string,
  operator: { id: string; allZonesAccess: boolean }
): Promise<ExpiredLaunchInfo> {
  const zones = await prisma.zone.findMany({
    where: {
      pointId,
      active: true,
      accountingMode: { in: ["stays", "launches"] },
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: { id: true, name: true, accountingMode: true },
    // Порядок задаёт владелец (Zone.sortOrder, /api/zones/[id]/move) — тот же
    // во всех списках зон, здесь от него зависит, какая зона считается первой.
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (zones.length === 0) {
    return {
      count: 0,
      firstAssetId: null,
      firstAssetZoneMode: null,
      firstIsExpired: false,
      firstAssetName: null,
      firstZoneName: null,
    };
  }
  const zoneModeById = new Map(zones.map((z) => [z.id, z.accountingMode as "stays" | "launches"]));
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));

  const launches = await prisma.launch.findMany({
    where: {
      zoneId: { in: zones.map((z) => z.id) },
      isOpen: true,
      pricingMode: "fixed",
      durationMinutesSnapshot: { not: null },
    },
    select: { zoneId: true, assetId: true, startedAt: true, durationMinutesSnapshot: true, asset: { select: { name: true } } },
    orderBy: { startedAt: "asc" },
  });

  const now = Date.now();
  const withExpiresAt = launches
    .filter((l) => l.durationMinutesSnapshot != null)
    .map((l) => ({ ...l, expiresAt: l.startedAt.getTime() + l.durationMinutesSnapshot! * 60000 }));
  const nearExpiry = withExpiresAt.filter((l) => now >= l.expiresAt - NEAR_EXPIRY_WINDOW_MS);

  const first = nearExpiry[0];
  return {
    count: nearExpiry.length,
    firstAssetId: first?.assetId ?? null,
    firstAssetZoneMode: first ? (zoneModeById.get(first.zoneId) ?? null) : null,
    firstIsExpired: first ? now >= first.expiresAt : false,
    firstAssetName: first?.asset?.name ?? null,
    firstZoneName: first ? (zoneNameById.get(first.zoneId) ?? null) : null,
  };
}

function roundMinutes(rawMinutes: number, mode: LaunchRoundingMode): number {
  if (mode === "up") return Math.ceil(rawMinutes);
  if (mode === "down") return Math.floor(rawMinutes);
  return Math.round(rawMinutes);
}

/**
 * Стоимость пуска при закрытии — по снапшоту тарифа на момент старта, не по
 * текущему тарифу зоны (docs/spec/04-game-room.md, "Пуск"). fixed — фикс.
 * цена вне зависимости от факт. длительности (длительность там только для
 * напоминания оператору, не для расчёта). per_minute — округлённые минуты ×
 * тариф, не ниже минималки.
 */
export function computeLaunchAmount(
  pricing: LaunchPricingSnapshot,
  startedAt: Date,
  endedAt: Date
): number {
  if (pricing.pricingMode === "fixed") {
    return Number(pricing.priceSnapshot);
  }

  // Округление — всегда вверх (запрос пользователя 2026-07-16: округление
  // вниз/математически недодаёт точке выручку за фактически занятое время);
  // fallback на случай null в старых записях, не сам выбор.
  const rawMinutes = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000);
  const mode = pricing.roundingModeSnapshot ?? "up";
  const minutes = roundMinutes(rawMinutes, mode);
  const amount = minutes * Number(pricing.priceSnapshot);
  const minAmount = pricing.minAmountSnapshot != null ? Number(pricing.minAmountSnapshot) : 0;
  return Math.max(amount, minAmount);
}

/**
 * Округление суммы пуска до целой валютной единицы — только
 * Zone.amountRoundingEnabled, только "per_minute" (запрос пользователя
 * 2026-07-27: "ребёнок зашёл на 30 секунд — нет смысла выставлять счёт в 30
 * копеек"). Правило: < 50 копеек — вниз, >= 50 — вверх (ровная середина
 * тоже вверх, уточнено тем же днём). Считается в целых копейках
 * (Math.round(amount * 100)), а не сравнением дробной части напрямую —
 * иначе граница .50 ловит погрешность плавающей точки (классический
 * 0.1 + 0.2 !== 0.3). Применяется В МОМЕНТ РАСЧЁТА, до записи Launch.amount
 * (см. /api/launches/[id]/stop/route.ts) — не как отображение поверх
 * настоящей суммы, иначе расчётная выручка/касса/"Разница" разъедутся с
 * тем, что реально записано (тот же класс проблемы, что уже нашли на
 * проде — Керен Центр, осиротевший пуск, 2026-07-27).
 */
export function roundToWholeCurrencyUnit(amount: number): number {
  const cents = Math.round(amount * 100);
  const wholeUnits = Math.floor(cents / 100);
  const remainderCents = cents - wholeUnits * 100;
  return remainderCents >= 50 ? wholeUnits + 1 : wholeUnits;
}

export interface GameRoomAggregate {
  count: number;
  totalAmount: number;
  totalMinutes: number;
  launchIds: string[];
  // Разбивка totalAmount по способу оплаты — только у "per_minute"/"По
  // факту" (у "fixed"/"За вход" paymentMethod не спрашивается, эти суммы в
  // разбивку не попадают, поэтому cashAmount+mobileAmount+abonementAmount
  // может быть МЕНЬШЕ totalAmount — это ожидаемо). Чисто справочная
  // величина: НЕ подставляется в поля кассы шага 4 мастера сдачи итогов
  // (запрос пользователя 2026-07-17: подстановка стёрла бы контроль
  // недостачи через "Разницу"). abonementAmount — запрос того же дня, третий
  // способ оплаты наравне с наличными/безналом.
  cashAmount: number;
  mobileAmount: number;
  abonementAmount: number;
}

/**
 * Агрегат завершённых, не аннулированных пусков зоны за период (docs/spec/
 * 04-game-room.md, "Деньги и сдача итогов") — используется и для расчётной
 * выручки в мастере сдачи итогов, и для карточки владельца/сводки.
 * `since` исключается (>), `until` включается (<=) — окно "с момента
 * предыдущей сдачи по текущий момент".
 */
export async function aggregateGameRoomLaunches(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<GameRoomAggregate> {
  const launches = await tx.launch.findMany({
    where: {
      zoneId,
      voidedAt: null,
      endedAt: { not: null, lte: until, ...(since ? { gt: since } : {}) },
      // paymentMethod ещё null — пуск только "заморожен" через
      // /api/launches/[id]/lock, ждёт выбор способа оплаты (запрос
      // пользователя 2026-07-27), НЕ завершён по-настоящему. Учитывать его
      // в расчётной выручке раньше времени — тот же класс бага, что уже
      // нашли на проде (Керен Центр, осиротевший пуск): пока он не оплачен,
      // граница следующей сдачи может уйти дальше его endedAt и он никогда
      // не попадёт ни в один агрегат — эта же причина уже блокирует сдачу
      // итогов, пока такой пуск существует (см. countOpenLaunchesInZone
      // ниже), поэтому его в принципе не должно быть тут на момент расчёта.
      paymentMethod: { not: null },
    },
    select: {
      id: true,
      amount: true,
      startedAt: true,
      endedAt: true,
      paymentMethod: true,
      pricingMode: true,
      durationMinutesSnapshot: true,
    },
  });

  let totalAmount = 0;
  let totalMinutes = 0;
  let cashAmount = 0;
  let mobileAmount = 0;
  let abonementAmount = 0;
  const splitLaunchIds: string[] = [];
  for (const l of launches) {
    const amount = Number(l.amount ?? 0);
    totalAmount += amount;
    // Сколько времени засчитать пуску — зависит от того, за что взяли деньги
    // (реальный случай на проде 2026-08-04, зона "Дворик": оплатили 300 ₽ за
    // 2 часа вперёд, сотрудник закрыл таймер через ЧЕТЫРЕ СЕКУНДЫ — отсчитывать
    // было нечего, время уже оплачено, — и в сводку ушло "время: 0 ч").
    //
    // "За вход" (pricingMode="fixed"): цена не зависит от того, пробыл гость
    // 30 минут или 10, время оплачено на входе — значит осмысленная величина
    // это ОПЛАЧЕННАЯ длительность (durationMinutesSnapshot), а не показания
    // секундомера. Фактическое время тут вообще ни на что не влияет.
    //
    // "По факту" (pricingMode="per_minute"): деньги считаются ровно по
    // отработанным минутам, поэтому засчитывается фактическая длительность —
    // как и раньше.
    if (l.pricingMode === "fixed" && l.durationMinutesSnapshot != null) {
      totalMinutes += l.durationMinutesSnapshot;
    } else if (l.endedAt) {
      totalMinutes += (l.endedAt.getTime() - l.startedAt.getTime()) / 60000;
    }
    if (l.paymentMethod === "cash") cashAmount += amount;
    else if (l.paymentMethod === "mobile") mobileAmount += amount;
    else if (l.paymentMethod === "abonement") abonementAmount += amount;
    // Разбивка оплаты (запрос пользователя 2026-07-26) — справочная, как и
    // сам paymentMethod (см. комментарий у Launch.paymentMethod в schema.prisma).
    else if (l.paymentMethod === PAYMENT_SPLIT_METHOD) splitLaunchIds.push(l.id);
  }
  if (splitLaunchIds.length > 0) {
    const legs = await tx.launchPaymentLeg.findMany({ where: { launchId: { in: splitLaunchIds } } });
    for (const leg of legs) {
      const legAmount = Number(leg.amount);
      if (leg.method === "cash") cashAmount += legAmount;
      else if (leg.method === "mobile") mobileAmount += legAmount;
      else if (leg.method === "abonement") abonementAmount += legAmount;
    }
  }

  return {
    count: launches.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalMinutes: Math.round(totalMinutes),
    launchIds: launches.map((l) => l.id),
    cashAmount: Math.round(cashAmount * 100) / 100,
    mobileAmount: Math.round(mobileAmount * 100) / 100,
    abonementAmount: Math.round(abonementAmount * 100) / 100,
  };
}

export interface AssetRevenueBreakdown {
  assetId: string;
  // Количество пусков этого актива в окне — запрос пользователя 2026-07-19,
  // тот же стиль, что уже показывают "Счётчики" (count + сумма на актив).
  count: number;
  // Расчётная выручка этого актива (сумма amount всех завершённых пусков,
  // "За вход" и "По факту" вместе) — показывается оператору READ-ONLY в
  // мастере сдачи итогов рядом с полем, куда он вносит реально собранную
  // сумму (запрос пользователя 2026-07-17: "внутри актива... сумма
  // расчётная как read only и сотрудник вносит реальные суммы — так мы
  // узнаем есть ли разница").
  calculatedAmount: number;
  // Тот же итог, разложенный по способу оплаты, которую оператор указал по
  // каждому браслету (при старте — "За вход", при остановке — "По факту",
  // см. paymentMethod у Launch) — чисто справочно, помогает быстрее
  // вспомнить реальную сумму, не подставляется в поля автоматически.
  // abonementAmount — запрос пользователя 2026-07-17, третий способ оплаты.
  cashAmount: number;
  mobileAmount: number;
  abonementAmount: number;
}

/**
 * Расчётная выручка "Прибываний" по каждому активу зоны отдельно (запрос
 * пользователя 2026-07-17: "должны отображаться Активы... по аналогии как
 * и со счётчиками") — зона может держать несколько активов, сваленные в
 * один общий итог были бы менее полезны оператору, физически считающему
 * кассу по каждому активу отдельно. Пропускает активы без завершённых
 * пусков в этом окне (нечего показать).
 */
export async function gameRoomRevenueByAsset(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<AssetRevenueBreakdown[]> {
  const launches = await tx.launch.findMany({
    where: {
      zoneId,
      voidedAt: null,
      endedAt: { not: null, lte: until, ...(since ? { gt: since } : {}) },
      // Тот же принцип, что у aggregateGameRoomLaunches выше — "заморожен",
      // но ещё не оплачен (paymentMethod null) не должен попасть сюда
      // раньше времени (запрос пользователя 2026-07-27).
      paymentMethod: { not: null },
    },
    select: { id: true, assetId: true, amount: true, paymentMethod: true },
  });

  const byAsset = new Map<
    string,
    { count: number; calculatedAmount: number; cashAmount: number; mobileAmount: number; abonementAmount: number }
  >();
  const splitAssetByLaunchId = new Map<string, string>();
  for (const l of launches) {
    if (!l.assetId) continue;
    const bucket =
      byAsset.get(l.assetId) ?? { count: 0, calculatedAmount: 0, cashAmount: 0, mobileAmount: 0, abonementAmount: 0 };
    const amount = Number(l.amount ?? 0);
    bucket.count += 1;
    bucket.calculatedAmount += amount;
    if (l.paymentMethod === "cash") bucket.cashAmount += amount;
    else if (l.paymentMethod === "mobile") bucket.mobileAmount += amount;
    else if (l.paymentMethod === "abonement") bucket.abonementAmount += amount;
    else if (l.paymentMethod === PAYMENT_SPLIT_METHOD) splitAssetByLaunchId.set(l.id, l.assetId);
    byAsset.set(l.assetId, bucket);
  }
  if (splitAssetByLaunchId.size > 0) {
    const legs = await tx.launchPaymentLeg.findMany({ where: { launchId: { in: [...splitAssetByLaunchId.keys()] } } });
    for (const leg of legs) {
      const assetId = splitAssetByLaunchId.get(leg.launchId);
      if (!assetId) continue;
      const bucket = byAsset.get(assetId)!;
      const legAmount = Number(leg.amount);
      if (leg.method === "cash") bucket.cashAmount += legAmount;
      else if (leg.method === "mobile") bucket.mobileAmount += legAmount;
      else if (leg.method === "abonement") bucket.abonementAmount += legAmount;
    }
  }

  return Array.from(byAsset.entries()).map(
    ([assetId, { count, calculatedAmount, cashAmount, mobileAmount, abonementAmount }]) => ({
      assetId,
      count,
      calculatedAmount: Math.round(calculatedAmount * 100) / 100,
      cashAmount: Math.round(cashAmount * 100) / 100,
      mobileAmount: Math.round(mobileAmount * 100) / 100,
      abonementAmount: Math.round(abonementAmount * 100) / 100,
    })
  );
}

export interface LaunchTallyEntry {
  assetId: string;
  tariffId: string;
  count: number;
  amount: number;
}

/**
 * Пуски "Пуски" (accountingMode="launches") с момента предыдущей сдачи —
 * по каждой паре актив+тариф отдельно (запрос пользователя 2026-07-17:
 * тариф не привязан к активу заранее, один и тот же актив держит пуски по
 * ОБОИМ тарифам зоны, как сейчас показания по обоим тарифам на актив в
 * counters/launches). `count` — то самое число "заездов", которое раньше
 * оператор вписывал вручную; здесь оно собирается из реальных тапов.
 */
export async function launchesRevenueByAssetAndTariff(
  zoneId: string,
  since: Date | null,
  until: Date,
  tx: Tx | typeof prisma = prisma
): Promise<LaunchTallyEntry[]> {
  const launches = await tx.launch.findMany({
    where: {
      zoneId,
      voidedAt: null,
      endedAt: { not: null, lte: until, ...(since ? { gt: since } : {}) },
    },
    select: { assetId: true, tariffId: true, amount: true },
  });

  const byKey = new Map<string, LaunchTallyEntry>();
  for (const l of launches) {
    if (!l.assetId || !l.tariffId) continue;
    const key = `${l.assetId}:${l.tariffId}`;
    const entry = byKey.get(key) ?? { assetId: l.assetId, tariffId: l.tariffId, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(l.amount ?? 0);
    byKey.set(key, entry);
  }

  return Array.from(byKey.values()).map((e) => ({ ...e, amount: Math.round(e.amount * 100) / 100 }));
}

/** Начало окна агрегации для зоны — время последней сдачи итогов по ней, иначе null (с самого начала). */
export async function previousSubmissionBoundary(zoneId: string, tx: Tx | typeof prisma = prisma): Promise<Date | null> {
  const last = await tx.zoneSubmission.findFirst({
    where: { zoneId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}
