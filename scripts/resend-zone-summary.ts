import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { calcSessions, calcZoneGrossRevenue, calcZoneRevenue, countersPaidFromBalance } from "../src/lib/results-calc";
import type { ZoneAccountingMode } from "../src/lib/results-calc";
import { getInitialReadingsMap } from "../src/lib/asset-initial-readings";
import { getZoneAbonementSpendAmount, getZoneTapAbonementAmount } from "../src/lib/abonement";
import { formatZoneSummaryTelegram } from "../src/lib/summary-channels/telegram-format";
import { ZONE_SUMMARY_DEFAULTS } from "../src/lib/summary-settings";
import { isLocale, type Locale } from "../src/lib/locales";
import { getDictionary } from "../src/lib/i18n";

/**
 * Досылка зонной сводки, которая не доехала до Telegram.
 *
 * Инцидент 2026-08-26 (владелец КидсБург): при сдаче итогов один запрос к
 * api.telegram.org оборвался с ECONNRESET, и сводка по зоне «Машинки»
 * потерялась молча — повторов тогда в коде не было (теперь есть, см.
 * callTelegramApi в src/lib/telegram-bot.ts). Само сообщение при этом уже не
 * восстановить ничем: сдача в базе, цифры в кабинете верные, а в чате зоны
 * просто нет.
 *
 * Отдельного пункта в меню владельца сознательно НЕ делаем (решение владельца
 * 2026-08-26) — это инструмент на редкий случай, а не рабочий сценарий.
 *
 * Работает только с зонами counters/cash_only (те же, что умеет править
 * владелец) и только со сдачей, у которой telegramSummaryMessageId пуст —
 * повторно уже отправленную сводку продублировать нельзя по конструкции.
 *
 * Текст собирается ровно тем же кодом, что и штатная сводка при сдаче
 * итогов, и БЕЗ пометки ♛: это не правка владельца, а то самое сообщение,
 * которое должно было уйти.
 *
 *   npx tsx scripts/resend-zone-summary.ts <zoneSubmissionId> [--dry]
 */
const zoneSubmissionId = process.argv[2];
const dryRun = process.argv.includes("--dry");

if (!zoneSubmissionId) {
  console.error("Укажи id сдачи по зоне: npx tsx scripts/resend-zone-summary.ts <zoneSubmissionId> [--dry]");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const zs = await prisma.zoneSubmission.findUnique({
    where: { id: zoneSubmissionId },
    include: {
      zone: {
        include: {
          point: true,
          tariffs: { where: { deletedAt: null } },
          assets: { orderBy: { sortOrder: "asc" } },
        },
      },
      assetReadings: true,
      resultsSubmission: { include: { operator: { select: { name: true, colorTag: true } } } },
    },
  });
  if (!zs) throw new Error(`Сдача по зоне ${zoneSubmissionId} не найдена`);
  if (zs.telegramSummaryMessageId) {
    throw new Error(`У этой сдачи сводка уже отправлена (message_id ${zs.telegramSummaryMessageId}) — досылать нечего`);
  }

  const tenantId = zs.zone.point.tenantId;
  const point = zs.zone.point;

  const [channel, zoneSummarySettings, tenant, pointCount] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
    }),
    prisma.zoneSummarySettings.findUnique({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, locale: true, timezone: true } }),
    prisma.point.count({ where: { tenantId } }),
  ]);
  if (!channel?.chatId) throw new Error("У тенанта нет активного Telegram-чата для сводок");

  const settings = zoneSummarySettings ?? ZONE_SUMMARY_DEFAULTS;
  const locale: Locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  const timezone = tenant?.timezone ?? "UTC";
  const st = getDictionary(locale).summaryText;

  // Предыдущая сдача ЭТОЙ ЖЕ зоны, строго до текущей — от неё считаются
  // дельты показаний и окно расхода абонементов (та же логика, что в
  // src/app/api/reports/counters/zone-submission/[id]/route.ts).
  const previous = await prisma.zoneSubmission.findFirst({
    where: { zoneId: zs.zoneId, createdAt: { lt: zs.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const boundary = previous?.createdAt ?? null;

  const isCashOnly = zs.zone.accountingMode === "cash_only";
  if (!isCashOnly && zs.zone.accountingMode !== "counters") {
    throw new Error(`Режим учёта «${zs.zone.accountingMode}» этот скрипт не собирает — только counters/cash_only`);
  }

  let calculatedRevenue = 0;
  let netRevenue = 0;
  let readingLines: { assetName: string; tariffName: string; reading: number; delta: number }[] = [];

  if (!isCashOnly) {
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
          return {
            assetName: asset.name,
            tariffName: tariff.name,
            reading: reading.reading,
            delta: calcSessions(reading.reading, previousReading),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    );
  }

  const abonementAmount = await getZoneAbonementSpendAmount(zs.zoneId, boundary, prisma, zs.createdAt);
  const paidFromBalance = countersPaidFromBalance(zs.zone, {
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
      showPointName: pointCount > 1,
      zoneName: zs.zone.name,
      zoneEmoji: zs.zone.telegramEmoji,
      accountingMode: zs.zone.accountingMode as ZoneAccountingMode,
      isGameRoom: false,
      gameRoomLaunchCount: null,
      gameRoomTotalMinutes: null,
      // Время самой сдачи, а не «сейчас»: сообщение приходит задним числом,
      // но событие в нём — то самое, вечернее.
      occurredAt: zs.resultsSubmission.submittedAt,
      readings: readingLines,
      perAsset: [],
      ticketsOrdersCount: null,
      ticketsCount: null,
      cashAmount: Number(zs.cashAmount),
      mobileAmount: Number(zs.mobileAmount),
      abonementAmount,
      calculatedRevenue,
      difference,
      returnsCount: zs.returnsCount,
      operatorName: zs.resultsSubmission.operator.name,
      operatorColorTag: zs.resultsSubmission.operator.colorTag,
    },
    settings,
    locale,
    timezone,
    st
  );

  console.log(`Зона: ${zs.zone.name} · точка: ${point.name} · тенант: ${tenant?.name ?? tenantId}`);
  console.log(`Чат: ${channel.chatId}`);
  console.log("--- текст сообщения ---");
  console.log(text);
  console.log("-----------------------");

  if (dryRun) {
    console.log("--dry: ничего не отправлено");
    return;
  }

  // Импорт отложенный: telegram-bot тянет свой экземпляр prisma через
  // алиас "@/lib/prisma" — грузим модуль только когда реально отправляем.
  const { sendChatMessage } = await import("../src/lib/telegram-bot");
  const result = await sendChatMessage(channel.chatId, text);
  if (!result.ok) {
    throw new Error(`Telegram отказал: status ${result.status} ${result.description ?? ""}`);
  }
  console.log(`Отправлено, message_id ${result.messageId}`);

  if (result.messageId) {
    await prisma.zoneSubmission.update({
      where: { id: zs.id },
      data: { telegramSummaryMessageId: result.messageId },
    });
    console.log("message_id записан на сдачу — будущие правки владельца будут править это сообщение");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
