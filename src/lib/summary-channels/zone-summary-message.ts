import { prisma } from "@/lib/prisma";
import { calcSessions, calcZoneGrossRevenue, calcZoneRevenue, countersPaidFromBalance } from "@/lib/results-calc";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";
import { getZoneAbonementSpendAmount, getZoneTapAbonementAmount } from "@/lib/abonement";
import { aggregateGameRoomLaunches, gameRoomRevenueByAsset } from "@/lib/game-room";
import { aggregateTicketOrders } from "@/lib/tickets";
import { editChatMessage } from "@/lib/telegram-bot";
import { formatZoneSummaryTelegram } from "@/lib/summary-channels/telegram-format";
import { ZONE_SUMMARY_DEFAULTS } from "@/lib/summary-settings";
import { isLocale, type Locale } from "@/lib/locales";
import { getDictionary } from "@/lib/i18n";
import { removeOrMarkMessage, sendUpdatedPush } from "@/lib/summary-channels/resync";
/**
 * Пересчитывает и редактирует уже отправленную Telegram-сводку по зоне после
 * правки кассы/показаний (запрос пользователя 2026-07-25: "на будущее сделай
 * сохранение id... чтобы такие ситуации можно было чинить").
 *
 * Считает все режимы, а не только counters/cash_only: с 2026-08-26 владельцу
 * открыта правка кассы и у «живых» зон (Прибывания/Билеты/тап-Пуски), а их
 * расчётная выручка живёт в пусках и заказах — без этой ветки правка кассы
 * переписала бы сводку нулями.
 *
 * Живёт отдельным модулем, а не внутри route.ts, чтобы тем же кодом могла
 * пользоваться разовая правка из командной строки
 * (scripts/fix-zone-submission-cash.ts) — иначе сообщение в чате и цифры в
 * базе разъезжаются в зависимости от того, чем правили.
 *
 * Best-effort — падение здесь не должно ронять саму правку, которая к этому
 * моменту уже сохранена.
 */
export async function resyncZoneSummaryMessage(
  zoneSubmissionId: string,
  tenantId: string,
  options: { voided?: boolean; editedByOwner?: boolean } = {}
): Promise<void> {
  const zs = await prisma.zoneSubmission.findUnique({
    where: { id: zoneSubmissionId },
    include: {
      zone: { include: { tariffs: { where: { deletedAt: null } }, assets: { orderBy: { sortOrder: "asc" } } } },
      assetReadings: true,
      resultsSubmission: { include: { operator: { select: { name: true, colorTag: true } } } },
    },
  });
  if (!zs?.telegramSummaryMessageId) return;

  const [channel, zoneSummarySettings, point, tenant] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
    }),
    prisma.zoneSummarySettings.findUnique({ where: { tenantId } }),
    prisma.point.findFirst({ where: { zones: { some: { id: zs.zoneId } } } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, locale: true, timezone: true } }),
  ]);
  if (!channel?.chatId || !point) return;

  const settings = zoneSummarySettings ?? ZONE_SUMMARY_DEFAULTS;
  if (!settings.enabled) return;

  const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  const timezone = tenant?.timezone ?? "UTC";
  const st = getDictionary(locale).summaryText;

  // Предыдущая сдача ЭТОЙ ЖЕ зоны, СТРОГО до текущей (previousSubmissionBoundary
  // из game-room.ts берёт "последнюю", а здесь текущая сдача сама и есть
  // последняя — нужна именно предыдущая, отсюда отдельный запрос).
  const previous = await prisma.zoneSubmission.findFirst({
    where: { zoneId: zs.zoneId, createdAt: { lt: zs.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const boundary = previous?.createdAt ?? null;

  const mode = zs.zone.accountingMode;
  const isCashOnly = mode === "cash_only";
  // «Живые» зоны — выручка живёт не в показаниях, а в пусках/заказах. Старые
  // "launches"-сдачи с ручным вводом (до 2026-07-17) сюда не относятся: у них
  // показания есть, и считаются они как counters (то же условие, что в
  // money/readings/page.tsx).
  const isLiveZone = mode === "stays" || mode === "tickets" || (mode === "launches" && zs.assetReadings.length === 0);
  let calculatedRevenue = 0;
  let netRevenue = 0;
  let readingLines: { assetName: string; tariffName: string; reading: number; delta: number }[] = [];
  let gameRoomLaunchCount: number | null = null;
  let gameRoomTotalMinutes: number | null = null;
  let ticketsOrdersCount: number | null = null;
  let ticketsCount: number | null = null;
  let perAsset: { assetName: string; count: number; amount: number }[] = [];
  // Оплата балансом у живых зон приходит из самого агрегата пусков/заказов, а
  // не из getZoneAbonementSpendAmount (тот источник — MoneyOperation на зоне,
  // у Прибываний/Билетов его нет).
  let liveAbonementAmount = 0;

  if (isLiveZone) {
    // Ровно тот же расчёт и то же окно, что у первичной сдачи
    // (submit-results/route.ts) — иначе правка кассы переписала бы сообщение
    // нулевой расчётной выручкой.
    if (mode === "tickets") {
      const agg = await aggregateTicketOrders(zs.zoneId, boundary, zs.createdAt);
      calculatedRevenue = agg.totalAmount;
      netRevenue = agg.totalAmount;
      ticketsOrdersCount = agg.ordersCount;
      ticketsCount = agg.ticketsCount;
      liveAbonementAmount = agg.abonementAmount;
    } else {
      const [agg, perAssetBreakdown] = await Promise.all([
        aggregateGameRoomLaunches(zs.zoneId, boundary, zs.createdAt),
        gameRoomRevenueByAsset(zs.zoneId, boundary, zs.createdAt),
      ]);
      const assetNameById = new Map(zs.zone.assets.map((a) => [a.id, a.name]));
      calculatedRevenue = agg.totalAmount;
      netRevenue = agg.totalAmount;
      gameRoomLaunchCount = agg.count;
      gameRoomTotalMinutes = agg.totalMinutes;
      liveAbonementAmount = agg.abonementAmount;
      perAsset = perAssetBreakdown
        .map((a) => ({ assetName: assetNameById.get(a.assetId) ?? "", count: a.count, amount: a.calculatedAmount }))
        .sort((a, b) => b.count - a.count);
    }
  } else if (!isCashOnly) {
    const previousReadings = await prisma.assetReading.findMany({
      where: { assetId: { in: zs.zone.assets.map((a) => a.id) }, zoneSubmissionId: { not: zs.id } },
      orderBy: { createdAt: "desc" },
    });
    const previousByKey = new Map<string, number>();
    for (const r of previousReadings) {
      const key = `${r.assetId}:${r.tariffId}`;
      if (!previousByKey.has(key)) previousByKey.set(key, r.reading);
    }
    const initialByKey = await getInitialReadingsMap(zs.zone.assets.map((a) => a.id));

    const tariffCalc = zs.zone.tariffs.map((tariff) => {
      const readingsForTariff = zs.assetReadings.filter((r) => r.tariffId === tariff.id);
      const sessions = readingsForTariff.reduce((sum, r) => {
        const key = `${r.assetId}:${tariff.id}`;
        const previousReading = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
        return sum + calcSessions(r.reading, previousReading);
      }, 0);
      return { tariffId: tariff.id, price: Number(tariff.price), sessions };
    });
    calculatedRevenue = calcZoneGrossRevenue(tariffCalc);
    netRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);

    readingLines = zs.zone.assets.flatMap((asset) =>
      zs.zone.tariffs
        .map((tariff) => {
          const reading = zs.assetReadings.find((r) => r.assetId === asset.id && r.tariffId === tariff.id);
          if (!reading) return null;
          const key = `${asset.id}:${tariff.id}`;
          const previousReading = previousByKey.get(key) ?? initialByKey.get(key) ?? 0;
          return { assetName: asset.name, tariffName: tariff.name, reading: reading.reading, delta: calcSessions(reading.reading, previousReading) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    );
  }

  // Оплата балансом вычитается из расчётной выручки (2026-08-13, см.
  // countersPaidFromBalance) — до этого была только информационной строкой, и
  // Разница здесь расходилась с той, что видел Сотрудник при сдаче.
  // TAP-зоны сюда тоже доходят (isZoneSubmissionEditable пускает любые
  // "counters", последние в цепочке), поэтому источник выбирается как везде:
  // тапы у tap-зон, весь зонный расход у ручных.
  const abonementAmount = isLiveZone
    ? liveAbonementAmount
    : await getZoneAbonementSpendAmount(zs.zoneId, boundary, prisma, zs.createdAt);
  // У живых зон вся оплата балансом уже учтена в агрегате и вычитается из
  // Разницы целиком (та же формула, что в submit-results): деньги пришли в
  // кассу раньше, при пополнении абонемента, а не этой сдачей.
  const paidFromBalance = isLiveZone
    ? liveAbonementAmount
    : countersPaidFromBalance(zs.zone, {
        zoneSpend: abonementAmount,
        tapLinked: zs.zone.countersTapAssistEnabled
          ? await getZoneTapAbonementAmount(
              zs.zoneId,
              new Map(zs.zone.tariffs.map((t) => [t.id, Number(t.price)])),
              boundary,
              zs.createdAt
            )
          : 0,
      });
  // + расходы, закрытые этой сдачей: сотрудник вводит в кассу остаток после
  // трат (решение владельца 2026-08-16), поэтому для сверки со счётчиками их
  // возвращаем обратно — иначе сводка после правки показала бы недостачу на
  // сумму расходов там, где касса сошлась.
  const expensesInSubmission = (
    await prisma.moneyOperation.findMany({
      where: { type: "expense", zoneId: zs.zoneId, resultsSubmissionId: zs.resultsSubmissionId },
      select: { amount: true },
    })
  ).reduce((sum, op) => sum + Math.abs(Number(op.amount)), 0);
  const actualCash = Number(zs.cashAmount) + Number(zs.mobileAmount);
  const difference = isCashOnly
    ? 0
    : Math.round((actualCash + expensesInSubmission - (netRevenue - paidFromBalance)) * 100) / 100;

  const text = formatZoneSummaryTelegram(
    {
      pointName: point.name,
      showPointName: (await prisma.point.count({ where: { tenantId } })) > 1,
      zoneName: zs.zone.name,
      zoneEmoji: zs.zone.telegramEmoji,
      accountingMode: zs.zone.accountingMode as import("@/lib/results-calc").ZoneAccountingMode,
      isGameRoom: mode === "stays",
      gameRoomLaunchCount,
      gameRoomTotalMinutes,
      occurredAt: zs.createdAt,
      readings: readingLines,
      perAsset,
      ticketsOrdersCount,
      ticketsCount,
      cashAmount: Number(zs.cashAmount),
      mobileAmount: Number(zs.mobileAmount),
      abonementAmount,
      calculatedRevenue,
      difference,
      returnsCount: zs.returnsCount,
      operatorName: zs.resultsSubmission.operator.name,
      operatorColorTag: zs.resultsSubmission.operator.colorTag,
      // ♛ рядом с именем сотрудника — метка «цифры правил владелец»
      // (требование владельца 2026-08-16). По умолчанию так и есть: сюда
      // приходят из правки в кабинете.
      editedByOwner: options.editedByOwner ?? true,
    },
    settings,
    locale,
    timezone,
    st
  );
  // Удаление сдачи: сообщение остаётся в чате (Telegram не отдаёт удалять
  // старше 48 часов), но прямо говорит, что записи больше нет — иначе в
  // чате навсегда висели бы цифры, которых в системе уже нет (правка
  // владельца 2026-08-16, тот же приём, что у сверки кассы Товаров).
  const finalText = options.voided
    ? `<i>${getDictionary(locale).summaryText.submissionVoided}</i>\n${text}`
    : text;
  if (options.voided) {
    // Удаляем сообщение целиком, а пометку оставляем только если Telegram
    // удалить не дал (решение владельца 2026-08-16).
    await removeOrMarkMessage(channel.chatId, zs.telegramSummaryMessageId, finalText);
  } else {
    await editChatMessage(channel.chatId, zs.telegramSummaryMessageId, text).catch(() => {});
  }
  // Push с уже поправленными цифрами: сообщение в чате исправлено, но у
  // владельца в шторке телефона всё ещё висит старое (требование владельца
  // 2026-08-16: "если происходят обновления в ТГ, то Push должны отправляться
  // свежие").
  await sendUpdatedPush(tenantId, "zoneSummary", getDictionary(locale).pushSettings.zoneLabel, finalText);
}
