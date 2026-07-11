import { prisma } from "@/lib/prisma";
import { getBusinessDayBounds, isAtBoundaryMinute, isAtTimeMinute } from "@/lib/business-day";
import { maybeSendDailyCashSummary } from "@/lib/summary-channels/daily-cash-trigger";
import { DAILY_CASH_SUMMARY_DEFAULTS, type DailyCashSummarySettingsData } from "@/lib/summary-settings";

// Планировщик "Кассы за день" — единственный источник time-based (не по
// действию пользователя) триггеров в проекте, поэтому просто setInterval
// внутри процесса (см. решение в чате: обычный сервер, не серверлесс, значит
// процесс живёт постоянно — системный cron был бы избыточен для одной задачи).
//
// Тик раз в минуту:
// 1. Режим "fixed" — если текущее время (UTC) совпадает с настроенным —
//    отправить сводку за бизнес-день, который сейчас идёт.
// 2. Предохранитель — если сейчас минута границы бизнес-дня, а день, который
//    только что закончился, ещё не отправлен ни в одном режиме — принудительно
//    отправить с пометкой "не все данные могли поступить" (см. ChatGPT-diff
//    в чате: "открытых смен" как явного состояния не существует в модуле
//    Смен — смена вводится целиком, поэтому это не "смена не закрыта", а
//    более честная общая пометка).
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Нет реального биллинга (докс, план+лимиты без денег, 2026-07-10) — админ
// вручную ставит дату окончания, а это просто переводит статус в expired,
// когда она прошла. Один UPDATE ... WHERE на тик, без обхода тенантов в JS.
async function expireSubscriptions(now: Date) {
  await prisma.tenant.updateMany({
    where: { subscriptionStatus: "active", subscriptionExpiresAt: { lt: now } },
    data: { subscriptionStatus: "expired" },
  });
}

async function tick() {
  const now = new Date();
  await expireSubscriptions(now);

  // Настройки материализуются лениво (см. GET /api/tenant/summary-settings/daily-cash —
  // такой же findUnique(...) ?? DEFAULTS, как и в реактивных вызовах из
  // submit-results/work-time-shifts), поэтому базой для обхода служит Tenant,
  // а не DailyCashSummarySettings — иначе тенант, ни разу не открывавший
  // настройки, был бы невидим для планировщика, хотя по умолчанию enabled: true.
  const tenants = await prisma.tenant.findMany({
    include: { points: true, dailyCashSummarySettings: true },
  });

  for (const tenant of tenants) {
    // businessDayBoundary — поле Tenant, не DailyCashSummarySettings
    // (docs/spec/05-work-time.md, перенесено 2026-07-11), поэтому докладывается
    // отдельно поверх остальных настроек сводки.
    const settings = {
      ...(tenant.dailyCashSummarySettings ?? DAILY_CASH_SUMMARY_DEFAULTS),
      businessDayBoundary: tenant.businessDayBoundary,
    } as DailyCashSummarySettingsData;
    if (!settings.enabled) continue;

    const bounds = getBusinessDayBounds(settings.businessDayBoundary, now);

    for (const point of tenant.points) {
      try {
        if (settings.sendMode === "fixed" && isAtTimeMinute(settings.fixedTime, now)) {
          await maybeSendDailyCashSummary(point.id, tenant.id, settings, bounds, false);
        }

        if (isAtBoundaryMinute(settings.businessDayBoundary, now)) {
          const prevBounds = { start: new Date(bounds.start.getTime() - 24 * 60 * 60 * 1000), end: bounds.start };
          await maybeSendDailyCashSummary(point.id, tenant.id, settings, prevBounds, true);
        }
      } catch (err) {
        console.error("summary scheduler tick failed", { pointId: point.id, err });
      }
    }
  }
}

export function startSummaryScheduler() {
  if (intervalHandle) return; // уже запущен — не плодить второй интервал при hot-reload
  intervalHandle = setInterval(() => {
    tick().catch((err) => console.error("summary scheduler tick failed", err));
  }, 60 * 1000);
}
