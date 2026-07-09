import { prisma } from "@/lib/prisma";
import { getBusinessDayBounds, businessDateKey } from "@/lib/business-day";
import { DAILY_CASH_SUMMARY_DEFAULTS, type DailyCashSummarySettingsData } from "@/lib/summary-settings";
import { buildDailyCashSummaryData, hasActivityInBounds } from "./daily-cash-data";
import { dispatchDailyCashSummary } from "./dispatch";

function toSettingsData(row: {
  enabled: boolean;
  sendMode: string;
  fixedTime: string;
  businessDayBoundary: string;
  skipIfNoSubmissions: boolean;
  updateOnLateSubmission: boolean;
  showCash: boolean;
  showExpenses: boolean;
  showZoneBreakdown: boolean;
  showCashOnHand: boolean;
}): DailyCashSummarySettingsData {
  return row as DailyCashSummarySettingsData;
}

/**
 * Первая отправка "Кассы за день" для точки+бизнес-дня — используется и
 * планировщиком (режим fixed / предохранитель на границе дня), и им же для
 * инициализации (если по какой-то причине точку ещё ни разу не отправляли).
 * Идемпотентна: если запись о доставке уже есть хотя бы по одному включённому
 * каналу — не отправляет повторно (повторная отправка того же дня — это
 * "досдача", см. maybeUpdateDailyCashSummary).
 */
export async function maybeSendDailyCashSummary(
  pointId: string,
  tenantId: string,
  settingsRow: Parameters<typeof toSettingsData>[0],
  bounds: { start: Date; end: Date },
  forcedIncomplete: boolean
): Promise<void> {
  const businessDate = businessDateKey(bounds);

  const alreadySent = await prisma.dailyCashSummaryDelivery.findFirst({
    where: { pointId, businessDate },
  });
  if (alreadySent) return;

  const settings = toSettingsData(settingsRow);
  const active = await hasActivityInBounds(pointId, bounds);
  if (!active && settings.skipIfNoSubmissions) return;

  const data = await buildDailyCashSummaryData(pointId, bounds, forcedIncomplete);
  if (!data) return;

  const results = await dispatchDailyCashSummary(tenantId, data, settings, {});

  for (const result of results) {
    if (!result.ok) continue;
    await prisma.dailyCashSummaryDelivery.upsert({
      where: { pointId_businessDate_channelType: { pointId, businessDate, channelType: result.channelType } },
      create: {
        tenantId,
        pointId,
        businessDate,
        channelType: result.channelType,
        externalMessageId: result.externalMessageId,
      },
      update: { externalMessageId: result.externalMessageId },
    });
  }
}

/**
 * Сколько активных зон точки уже отчитались хотя бы одной сдачей итогов за
 * бизнес-день (для режима "event" — см. onResultsSubmission ниже).
 * Деактивированные зоны (Zone.active=false) не считаются ни в ожидаемых, ни
 * в отчитавшихся — временно закрытая зона (ремонт/сезон) не должна вечно
 * держать сводку в ожидании.
 */
async function getZoneCoverage(
  pointId: string,
  bounds: { start: Date; end: Date }
): Promise<{ activeZones: number; coveredZones: number }> {
  const [activeZones, coveredRows] = await Promise.all([
    prisma.zone.count({ where: { pointId, active: true } }),
    prisma.zoneSubmission.findMany({
      where: {
        zone: { active: true },
        resultsSubmission: { pointId, submittedAt: { gte: bounds.start, lt: bounds.end } },
      },
      select: { zoneId: true },
      distinct: ["zoneId"],
    }),
  ]);
  return { activeZones, coveredZones: coveredRows.length };
}

/**
 * Реактивный хук из submit-results (не из планировщика): вызывается после
 * КАЖДОЙ сдачи итогов. Две разные ветки:
 * — если по точке+бизнес-дню сводка ещё не уходила и режим "event" — проверяет
 *   покрытие зон (getZoneCoverage) и отправляет сразу, как только все активные
 *   зоны точки отчитались хотя бы раз за сегодня;
 * — если уже уходила — это досдача (notifyDailyCashLateSubmission), независимо
 *   от режима отправки (fixed тоже должен обновляться при досдаче).
 * Предохранитель на границе бизнес-дня (планировщик, forcedIncomplete) остаётся
 * единственной сетью для случая "зона за весь день так и не отчиталась".
 */
export async function onResultsSubmission(pointId: string, tenantId: string, at: Date): Promise<void> {
  const settingsRow = await prisma.dailyCashSummarySettings.findUnique({ where: { tenantId } });
  const settings = settingsRow ? toSettingsData(settingsRow) : DAILY_CASH_SUMMARY_DEFAULTS;
  if (!settings.enabled) return;

  const bounds = getBusinessDayBounds(settings.businessDayBoundary, at);
  const businessDate = businessDateKey(bounds);

  const alreadySent = await prisma.dailyCashSummaryDelivery.findFirst({ where: { pointId, businessDate } });
  if (alreadySent) {
    await notifyDailyCashLateSubmission(pointId, tenantId, at);
    return;
  }

  if (settings.sendMode !== "event") return; // fixed — ждёт своего часа у планировщика

  const { activeZones, coveredZones } = await getZoneCoverage(pointId, bounds);
  if (activeZones === 0 || coveredZones < activeZones) return; // ещё не все активные зоны отчитались

  await maybeSendDailyCashSummary(pointId, tenantId, settingsRow ?? DAILY_CASH_SUMMARY_DEFAULTS, bounds, false);
}

/**
 * Досдача: точка+бизнес-день УЖЕ отправлялись, но появилась новая активность
 * (новая сдача итогов/смена) — перестроить данные и либо отредактировать
 * существующее сообщение (settings.updateOnLateSubmission), либо отправить
 * новое. Вызывается реактивно из submit-results/work-time-shifts роутов, а
 * не планировщиком.
 */
export async function notifyDailyCashLateSubmission(pointId: string, tenantId: string, at: Date): Promise<void> {
  const settingsRow = await prisma.dailyCashSummarySettings.findUnique({ where: { tenantId } });
  if (!settingsRow?.enabled) return;

  const bounds = getBusinessDayBounds(settingsRow.businessDayBoundary, at);
  const businessDate = businessDateKey(bounds);

  const existingDeliveries = await prisma.dailyCashSummaryDelivery.findMany({
    where: { pointId, businessDate },
  });
  if (existingDeliveries.length === 0) return; // ничего не отправляли — это Шаг обычной первой отправки, не досдача

  const settings = toSettingsData(settingsRow);
  const data = await buildDailyCashSummaryData(pointId, bounds, false);
  if (!data) return;

  const existingMessageIds: Partial<Record<"telegram" | "email", string>> = {};
  for (const d of existingDeliveries) {
    if (d.channelType === "telegram" && d.externalMessageId) existingMessageIds.telegram = d.externalMessageId;
  }

  const results = await dispatchDailyCashSummary(tenantId, data, settings, existingMessageIds);

  for (const result of results) {
    if (!result.ok) continue;
    await prisma.dailyCashSummaryDelivery.upsert({
      where: { pointId_businessDate_channelType: { pointId, businessDate, channelType: result.channelType } },
      create: {
        tenantId,
        pointId,
        businessDate,
        channelType: result.channelType,
        externalMessageId: result.externalMessageId,
      },
      update: { externalMessageId: result.externalMessageId },
    });
  }
}
