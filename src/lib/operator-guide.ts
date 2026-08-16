import { prisma } from "@/lib/prisma";
import { getTenantModuleFlags } from "@/lib/tenant-modules";
import { isSelfServicePayoutMode, type SelfServicePayoutMode } from "@/lib/self-service-payout";

/**
 * «Как работать» — памятка сотрудника, которая собирается под него самого
 * (решение владельца 2026-08-16). Не запись в базе и не инструктаж: без
 * версий, без подписи, удалить её нельзя — она просто всегда актуальна,
 * потому что каждый раз строится по текущим настройкам.
 *
 * Здесь только СОСТАВ: какие блоки показать и какие данные в них подставить.
 * Сами тексты живут в словаре и подставляются на клиенте — иначе перевод
 * пришлось бы тащить через API на каждый запрос.
 *
 * Правило состава простое: показываем ровно то, с чем этот человек реально
 * встретится. У сотрудника без товаров не должно быть ни слова про склад, а
 * у зала со счётчиками — про билеты; лишний раздел не просто бесполезен, он
 * заставляет искать у себя функции, которых нет.
 */

/** Как считаются заезды в конкретной зоне — подпись справа от её названия. */
export type ZoneGuideMode =
  | "counters"
  | "countersTap"
  | "staysEntry"
  | "staysTime"
  | "launches"
  | "launchesTimer"
  | "tickets"
  | "cashOnly";

export interface OperatorGuideZone {
  id: string;
  name: string;
  iconKey: string | null;
  emoji: string | null;
  mode: ZoneGuideMode;
}

export interface OperatorGuideData {
  operatorName: string;
  pointName: string;
  timeTracking: "auto" | "manual";
  zones: OperatorGuideZone[];
  blocks: {
    /** Показания переписываются с дисплея — есть хоть одна обычная зона «Счётчики». */
    counters: boolean;
    /** Заезды отмечаются нажатием — есть tap-зона. */
    countersTap: boolean;
    /** Возврат/тест применим — он есть в обоих вариантах «Счётчиков». */
    returns: boolean;
    stays: boolean;
    /** Хоть у одной поминутной зоны включено округление итоговой суммы. */
    staysRounding: boolean;
    launches: boolean;
    launchesTimer: boolean;
    tickets: boolean;
    /** Гашение включено хотя бы в одной билетной зоне. */
    ticketsRedemption: boolean;
    goods: boolean;
    goodsRevision: boolean;
    /** Товары можно оплатить с баланса — разрешено владельцем и есть модуль «Клиенты». */
    goodsBalance: boolean;
    /** Сотрудник сам выбирает способ оплаты — только там, где оплата идёт за конкретное событие. */
    payments: boolean;
    /** Баланс клиента как способ оплаты — модуль «Клиенты». */
    balance: boolean;
    /** Пополнение баланса (продажа абонемента) — модуль «Клиенты». */
    abonements: boolean;
    /** Списание с баланса в «Счётчиках» живёт отдельным экраном, не в «Клиентах». */
    balanceSpendCounters: boolean;
    expenses: boolean;
    /** Касса вводится по каждому активу — «Прибывания» и «Пуски». */
    submitByAsset: boolean;
    /** Сотруднику показывают разницу при сдаче. */
    showDifference: boolean;
    /** Печать доступна: включена у тенанта И на этом устройстве есть принтер. */
    print: boolean;
    /** Как сотруднику разрешено брать аванс/премию; null — нельзя вовсе. */
    payout: Exclude<SelfServicePayoutMode, "forbidden"> | null;
    tasks: boolean;
  };
}

function zoneMode(zone: {
  accountingMode: string;
  countersTapAssistEnabled: boolean;
  tariffs: { pricingMode: string | null }[];
}): ZoneGuideMode {
  switch (zone.accountingMode) {
    case "counters":
      return zone.countersTapAssistEnabled ? "countersTap" : "counters";
    case "stays":
      // «По факту» — поминутный тариф; всё остальное считается за вход.
      // Смотрим по тарифам зоны, а не по названию: владелец волен назвать
      // тариф как угодно.
      return zone.tariffs.some((t) => t.pricingMode === "per_minute") ? "staysTime" : "staysEntry";
    case "launches":
      // Таймерный вариант — тариф с фиксированной длительностью; плоский
      // тариф длительности не имеет.
      return zone.tariffs.some((t) => t.pricingMode === "fixed") ? "launchesTimer" : "launches";
    case "tickets":
      return "tickets";
    default:
      return "cashOnly";
  }
}

export async function buildOperatorGuide(params: {
  operator: { id: string; name: string; allZonesAccess: boolean; goodsAccess: boolean; revisionAccess: boolean; ticketsAccess: boolean; timeTrackingMode: string; showDifferenceOnSubmit: boolean; selfServicePayoutAllowed: boolean };
  point: { id: string; name: string; tenantId: string };
  deviceHasPrinter: boolean;
}): Promise<OperatorGuideData> {
  const { operator, point, deviceHasPrinter } = params;

  const [zones, tenant, modules] = await Promise.all([
    prisma.zone.findMany({
      where: {
        pointId: point.id,
        active: true,
        ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
      },
      select: {
        id: true,
        name: true,
        iconKey: true,
        telegramEmoji: true,
        accountingMode: true,
        countersTapAssistEnabled: true,
        amountRoundingEnabled: true,
        ticketRedemptionEnabled: true,
        printReceiptEnabled: true,
        tariffs: { where: { deletedAt: null }, select: { pricingMode: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findUnique({
      where: { id: point.tenantId },
      select: {
        expensesEnabled: true,
        printingEnabled: true,
        goodsAllowBalancePayment: true,
        selfServicePayoutMode: true,
      },
    }),
    getTenantModuleFlags(point.tenantId),
  ]);

  const guideZones: OperatorGuideZone[] = zones.map((z) => ({
    id: z.id,
    name: z.name,
    iconKey: z.iconKey,
    emoji: z.telegramEmoji,
    mode: zoneMode(z),
  }));

  const has = (mode: ZoneGuideMode) => guideZones.some((z) => z.mode === mode);
  const ticketsVisible = has("tickets") && operator.ticketsAccess;
  const goodsVisible = modules.goodsEnabled && operator.goodsAccess;
  const clients = modules.clientsEnabled;

  // Способ оплаты сотрудник выбирает только там, где деньги принимаются за
  // конкретное событие: посещение, заезд, заказ билетов, продажу товара. У
  // «Счётчиков» оплата за отдельный заезд не вводится вовсе — там только
  // итоговая касса на сдаче, и раздел про способы оплаты был бы про
  // несуществующий экран.
  const payments =
    has("staysEntry") || has("staysTime") || has("launches") || has("launchesTimer") || ticketsVisible || goodsVisible;

  const payoutMode = isSelfServicePayoutMode(tenant?.selfServicePayoutMode) ? tenant.selfServicePayoutMode : "cash";

  return {
    operatorName: operator.name,
    pointName: point.name,
    timeTracking: operator.timeTrackingMode === "auto" ? "auto" : "manual",
    zones: guideZones,
    blocks: {
      counters: has("counters"),
      countersTap: has("countersTap"),
      returns: has("counters") || has("countersTap"),
      stays: has("staysEntry") || has("staysTime"),
      staysRounding: zones.some((z) => z.accountingMode === "stays" && z.amountRoundingEnabled),
      launches: has("launches") || has("launchesTimer"),
      launchesTimer: has("launchesTimer"),
      tickets: ticketsVisible,
      ticketsRedemption: zones.some((z) => z.accountingMode === "tickets" && z.ticketRedemptionEnabled) && ticketsVisible,
      goods: goodsVisible,
      goodsRevision: goodsVisible && operator.revisionAccess,
      goodsBalance: goodsVisible && clients && (tenant?.goodsAllowBalancePayment ?? true),
      payments,
      balance: clients && payments,
      abonements: clients,
      // Списание с баланса на «Счётчиках» — отдельный экран, единственный
      // путь для этого действия (см. комментарий в operator/abonements).
      balanceSpendCounters: clients && (has("counters") || has("countersTap")),
      expenses: tenant?.expensesEnabled ?? true,
      submitByAsset: has("staysEntry") || has("staysTime") || has("launches") || has("launchesTimer"),
      showDifference: operator.showDifferenceOnSubmit,
      // Печать показываем, только если она реально доступна на этом
      // устройстве: рубильник тенанта И принтер у самого устройства. Зонный
      // тумблер квитанции сюда не входит — он решает, печатать ли конкретную
      // квитанцию, а не есть ли печать вообще.
      print: (tenant?.printingEnabled ?? false) && deviceHasPrinter,
      payout: !operator.selfServicePayoutAllowed || payoutMode === "forbidden" ? null : payoutMode,
      tasks: modules.tasksEnabled,
    },
  };
}
