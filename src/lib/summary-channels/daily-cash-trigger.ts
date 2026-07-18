import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getBusinessDayBounds, businessDateKey } from "@/lib/business-day";
import { DAILY_CASH_SUMMARY_DEFAULTS, type DailyCashSummarySettingsData } from "@/lib/summary-settings";
import { buildDailyCashSummaryData, hasActivityInBounds } from "./daily-cash-data";
import { dispatchDailyCashSummary, getEnabledChannels } from "./dispatch";

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// businessDayBoundary живёт на Tenant, не на DailyCashSummarySettings
// (docs/spec/05-work-time.md, перенесено 2026-07-11 — значение общетенантное,
// его же читает Рабочее время) — поэтому собирается отдельным параметром,
// не полем самой строки настроек.
function toSettingsData(
  row: {
    enabled: boolean;
    sendMode: string;
    fixedTime: string;
    skipIfNoSubmissions: boolean;
    updateOnLateSubmission: boolean;
    showCash: boolean;
    showExpenses: boolean;
    showZoneBreakdown: boolean;
    showCashOnHand: boolean;
  },
  businessDayBoundary: string
): DailyCashSummarySettingsData {
  return { ...row, businessDayBoundary } as DailyCashSummarySettingsData;
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
  settings: DailyCashSummarySettingsData,
  bounds: { start: Date; end: Date },
  forcedIncomplete: boolean,
  timezone: string
): Promise<void> {
  const businessDate = businessDateKey(bounds, timezone);

  const alreadySent = await prisma.dailyCashSummaryDelivery.findFirst({
    where: { pointId, businessDate },
  });
  if (alreadySent) return;

  const active = await hasActivityInBounds(pointId, bounds);
  if (!active && settings.skipIfNoSubmissions) return;

  // Атомарный захват ДО реальной отправки, не после (реальная гонка, найдена
  // пользователем 2026-07-19: планировщик тикает раз в минуту в каждом живом
  // процессе — на перезапуске контейнера старый и новый процесс могут
  // недолго жить одновременно, у обоих свой таймер; findFirst-затем-upsert
  // оставлял окно, где оба вызова проходили проверку "уже отправлено?" до
  // того, как первый успевал это записать, и оба реально слали сообщение в
  // Telegram — тот же класс бага, что чинили для премии/аванса на check-out
  // 2026-07-18, здесь с другой стороны). INSERT с уникальным индексом
  // (pointId, businessDate, channelType) ловит гонку атомарно на уровне БД:
  // конкурентный вызов получает P2002 и останавливается ДО отправки.
  const channels = await getEnabledChannels(tenantId);
  const claimed: ("telegram" | "email")[] = [];
  for (const channel of channels) {
    try {
      await prisma.dailyCashSummaryDelivery.create({
        data: { tenantId, pointId, businessDate, channelType: channel.channelType },
      });
      claimed.push(channel.channelType);
    } catch (err) {
      if (isUniqueConstraintViolation(err)) continue; // уже занято параллельным вызовом
      throw err;
    }
  }
  if (claimed.length === 0) return;

  const data = await buildDailyCashSummaryData(pointId, bounds, forcedIncomplete);
  if (!data) {
    await prisma.dailyCashSummaryDelivery.deleteMany({ where: { pointId, businessDate, channelType: { in: claimed } } });
    return;
  }

  const results = await dispatchDailyCashSummary(tenantId, data, settings, {});
  const resultByChannel = new Map(results.map((r) => [r.channelType, r]));

  for (const channelType of claimed) {
    const result = resultByChannel.get(channelType);
    if (result?.ok) {
      await prisma.dailyCashSummaryDelivery.update({
        where: { pointId_businessDate_channelType: { pointId, businessDate, channelType } },
        data: { externalMessageId: result.externalMessageId },
      });
    } else {
      // Отправка не удалась (или канал вообще не сработал — например,
      // chatStatus не active, тогда его вообще нет в results) — освобождаем
      // слот, чтобы следующий тик мог честно повторить попытку, а не считал
      // точку навсегда "отправленной" без реального сообщения.
      await prisma.dailyCashSummaryDelivery.deleteMany({ where: { pointId, businessDate, channelType } });
    }
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

// "Все зоны отчитались" само по себе не значит "день закончился" — оператор
// мог сдать итоги по каждой зоне рано и продолжать работать (запрос
// пользователя 2026-07-14: не отправлять "итог дня", пока он ещё не закончен).
// Модуль "Рабочее время" не фича-флаг (больше не отключается по тенантам) —
// если у точки вообще никогда не было смен (никто не пользуется Авто-режимом
// на этой точке), Shift.findFirst просто ничего не найдёт и это условие
// пройдёт само собой, ничего искусственно обходить не нужно.
async function hasOpenShiftsAtPoint(pointId: string): Promise<boolean> {
  const openShift = await prisma.shift.findFirst({ where: { pointId, isOpen: true }, select: { id: true } });
  return openShift !== null;
}

async function loadSettingsAndBounds(
  tenantId: string,
  at: Date
): Promise<{ settings: DailyCashSummarySettingsData; bounds: { start: Date; end: Date }; timezone: string }> {
  const [settingsRow, tenant] = await Promise.all([
    prisma.dailyCashSummarySettings.findUnique({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { businessDayBoundary: true, timezone: true } }),
  ]);
  const businessDayBoundary = tenant?.businessDayBoundary ?? DAILY_CASH_SUMMARY_DEFAULTS.businessDayBoundary;
  const settings = settingsRow
    ? toSettingsData(settingsRow, businessDayBoundary)
    : { ...DAILY_CASH_SUMMARY_DEFAULTS, businessDayBoundary };
  const timezone = tenant?.timezone ?? "UTC";
  const bounds = getBusinessDayBounds(settings.businessDayBoundary, at, timezone);
  return { settings, bounds, timezone };
}

/**
 * Общая проверка "пора ли отправить сегодняшнюю Кассу за день впервые" —
 * общая для двух реактивных хуков ниже (onResultsSubmission/onShiftClosed).
 * Условие двойное (запрос пользователя 2026-07-14): все активные зоны
 * отчитались за сегодня И на точке не осталось ни одной открытой смены —
 * раньше проверялось только первое, из-за чего сводка могла уйти, пока
 * оператор ещё физически работает (успел один раз сдать итоги по каждой
 * зоне, но день ещё не закончен).
 */
async function maybeSendOnEvent(
  pointId: string,
  tenantId: string,
  settings: DailyCashSummarySettingsData,
  bounds: { start: Date; end: Date },
  timezone: string
): Promise<void> {
  if (settings.sendMode !== "event") return; // fixed — ждёт своего часа у планировщика

  const [{ activeZones, coveredZones }, openShifts] = await Promise.all([
    getZoneCoverage(pointId, bounds),
    hasOpenShiftsAtPoint(pointId),
  ]);
  if (activeZones === 0 || coveredZones < activeZones || openShifts) return;

  await maybeSendDailyCashSummary(pointId, tenantId, settings, bounds, false, timezone);
}

/**
 * Реактивный хук из submit-results (не из планировщика): вызывается после
 * КАЖДОЙ сдачи итогов. Две разные ветки:
 * — если по точке+бизнес-дню сводка ещё не уходила — проверяет через
 *   maybeSendOnEvent, пора ли отправлять (зоны + смены);
 * — если уже уходила — это досдача (notifyDailyCashLateSubmission), независимо
 *   от режима отправки (fixed тоже должен обновляться при досдаче).
 * Предохранитель на границе бизнес-дня (планировщик, forcedIncomplete) остаётся
 * единственной сетью для случая "зона/смена за весь день так и не закрылась".
 */
export async function onResultsSubmission(pointId: string, tenantId: string, at: Date): Promise<void> {
  const { settings, bounds, timezone } = await loadSettingsAndBounds(tenantId, at);
  if (!settings.enabled) return;

  const businessDate = businessDateKey(bounds, timezone);
  const alreadySent = await prisma.dailyCashSummaryDelivery.findFirst({ where: { pointId, businessDate } });
  if (alreadySent) {
    await notifyDailyCashLateSubmission(pointId, tenantId, at);
    return;
  }

  await maybeSendOnEvent(pointId, tenantId, settings, bounds, timezone);
}

/**
 * Реактивный хук из check-out (запрос пользователя 2026-07-14) — симметричен
 * onResultsSubmission, но с другой стороны: если все зоны уже отчитались, а
 * последнее, чего не хватало для отправки — закрытия смен, именно закрытие
 * последней открытой смены и должно запустить первую отправку. Если сводка
 * уже уходила сегодня — не досдача (закрытие смены само по себе кассу не
 * меняет, в отличие от привязанного к ней аванса/премии) — этим по-прежнему
 * занимается check-out/route.ts напрямую через notifyDailyCashLateSubmission,
 * только когда реально есть аванс/премия.
 */
export async function onShiftClosed(pointId: string, tenantId: string, at: Date): Promise<void> {
  const { settings, bounds, timezone } = await loadSettingsAndBounds(tenantId, at);
  if (!settings.enabled) return;

  const businessDate = businessDateKey(bounds, timezone);
  const alreadySent = await prisma.dailyCashSummaryDelivery.findFirst({ where: { pointId, businessDate } });
  if (alreadySent) return;

  await maybeSendOnEvent(pointId, tenantId, settings, bounds, timezone);
}

/**
 * Досдача: точка+бизнес-день УЖЕ отправлялись, но появилась новая активность
 * (новая сдача итогов/смена) — перестроить данные и либо отредактировать
 * существующее сообщение (settings.updateOnLateSubmission), либо отправить
 * новое. Вызывается реактивно из submit-results/work-time-shifts роутов, а
 * не планировщиком.
 */
export async function notifyDailyCashLateSubmission(pointId: string, tenantId: string, at: Date): Promise<void> {
  const [settingsRow, tenant] = await Promise.all([
    prisma.dailyCashSummarySettings.findUnique({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { businessDayBoundary: true, timezone: true } }),
  ]);
  if (!settingsRow?.enabled) return;

  const businessDayBoundary = tenant?.businessDayBoundary ?? DAILY_CASH_SUMMARY_DEFAULTS.businessDayBoundary;
  const timezone = tenant?.timezone ?? "UTC";
  const bounds = getBusinessDayBounds(businessDayBoundary, at, timezone);
  const businessDate = businessDateKey(bounds, timezone);

  const existingDeliveries = await prisma.dailyCashSummaryDelivery.findMany({
    where: { pointId, businessDate },
  });
  if (existingDeliveries.length === 0) return; // ничего не отправляли — это Шаг обычной первой отправки, не досдача

  const settings = toSettingsData(settingsRow, businessDayBoundary);
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
