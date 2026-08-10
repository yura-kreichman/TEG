import { prisma } from "@/lib/prisma";
import { getBusinessDayBounds, isAtBoundaryMinute, isAtTimeMinute, previousBusinessDayBounds } from "@/lib/business-day";
import { hasActivityInBounds } from "@/lib/summary-channels/daily-cash-data";
import { maybeSendDailyCashSummary } from "@/lib/summary-channels/daily-cash-trigger";
import { DAILY_CASH_SUMMARY_DEFAULTS, type DailyCashSummarySettingsData } from "@/lib/summary-settings";
import { sendTicketExpiryReminders } from "@/lib/ticket-expiry-reminders";
import { runTenantPurgeCycle } from "@/lib/tenant-lifecycle";

// Небольшая пауза между отправками точек одного тика (запрос пользователя
// 2026-07-18: "между отправками сводок... для уверенности") — единственное
// место в проекте, где сообщения в один Telegram-чат реально могут уйти
// почти одновременно: у тенанта с несколькими точками на одном фиксированном
// времени отправки все точки шлются в одном тике подряд, без паузы рискуя
// упереться в лимит Telegram (~1 сообщение/сек на чат). В реактивных
// отправках (после сдачи итогов/закрытия смены) паузы нет и не нужно —
// они и так естественно разнесены действиями человека.
const BETWEEN_POINTS_DELAY_MS = 500;
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Планировщик "Кассы за день" — единственный источник time-based (не по
// действию пользователя) триггеров в проекте, поэтому просто setInterval
// внутри процесса (см. решение в чате: обычный сервер, не серверлесс, значит
// процесс живёт постоянно — системный cron был бы избыточен для одной задачи).
//
// Тик раз в минуту:
// 1. Режим "fixed" — если текущее время совпадает с настроенным, отправить
//    сводку за прошедший день (см. разбор у самой ветки ниже: за текущий, если
//    в нём уже есть сдачи, иначе за предыдущий).
// 2. Предохранитель — только для режима "event": если сейчас минута границы
//    бизнес-дня, а день, который только что закончился, так и не отправлен —
//    отправить с пометкой, что именно не закрыли.
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Нет реального биллинга (докс, план+лимиты без денег, 2026-07-10) — админ
// вручную ставит дату окончания (или она проставляется автоматически при
// регистрации на Free, см. FREE_TRIAL_DAYS в api/auth/register/route.ts), а
// это просто переводит статус в expired, когда она прошла. Один UPDATE ...
// WHERE на тик, без обхода тенантов в JS.
//
// unlimited: false — реальный пробел, найден пользователем 2026-07-29:
// "Free должен действовать месяц, если я не поставил ему осознанно
// безлимит" — Tenant.unlimited (ручной рубильник Super Admin'а, снимает
// лимиты ресурсов) раньше никак не влиял на этот таймер, тенант с
// unlimited=true всё равно тихо переходил в expired через 30 дней. Теперь
// unlimited защищает и от истечения подписки, не только от лимитов —
// именно так это поле описано пользователю ("осознанно поставил безлимит").
async function expireSubscriptions(now: Date) {
  await prisma.tenant.updateMany({
    where: { subscriptionStatus: "active", subscriptionExpiresAt: { lt: now }, unlimited: false },
    data: { subscriptionStatus: "expired" },
  });
}

async function tick() {
  const now = new Date();
  await expireSubscriptions(now);
  // Брошенные Free-кабинеты: два письма, затем удаление везде (решение
  // пользователя 2026-08-10, src/lib/tenant-lifecycle.ts). Ошибка одного
  // тенанта не должна ронять весь тик — внутри цикла свой try, здесь только
  // страховка от падения самой выборки.
  await runTenantPurgeCycle(now).catch((err) => console.error("tenant purge cycle failed", err));
  await sendTicketExpiryReminders(now).catch((err) => console.error("ticket expiry reminders tick failed", err));

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

    const bounds = getBusinessDayBounds(settings.businessDayBoundary, now, tenant.timezone);

    for (const point of tenant.points) {
      try {
        if (settings.sendMode === "fixed" && isAtTimeMinute(settings.fixedTime, now, tenant.timezone)) {
          // "Присылать в 03:00" человек понимает как "итоги за прошедший
          // день", а не "за день, который начался три часа назад и пока пуст"
          // (реальная ловушка, найдена пользователем 2026-08-06: у тенанта,
          // не работающего после полуночи, назначенное на ночь время не
          // отправляло НИЧЕГО — окно текущего дня было пустым, а тумблер "Не
          // отправлять без сдач" честно молчал).
          //
          // Поэтому: пустой текущий день + непустой предыдущий = отправляем
          // предыдущий. Для тех, кто работает после полуночи, правило даёт тот
          // же ответ само собой — у них в три ночи текущий бизнес-день и есть
          // вчерашний, никаких исключений не нужно.
          const prevBounds = previousBusinessDayBounds(settings.businessDayBoundary, bounds, tenant.timezone);
          const target = (await hasActivityInBounds(point.id, bounds)) ? bounds : prevBounds;
          await maybeSendDailyCashSummary(point.id, tenant.id, settings, target, false, tenant.timezone);
        }

        // Предохранитель на границе дня — только для отправки по событию: там
        // условия могут не сложиться никогда (забыли закрыть смену). В
        // фиксированном режиме гарантия — само назначенное время, и второй
        // механизм только перебивал первый, присылая сводку на границе вместо
        // выбранного владельцем часа.
        if (settings.sendMode === "event" && isAtBoundaryMinute(settings.businessDayBoundary, now, tenant.timezone)) {
          const prevBounds = previousBusinessDayBounds(settings.businessDayBoundary, bounds, tenant.timezone);
          await maybeSendDailyCashSummary(point.id, tenant.id, settings, prevBounds, true, tenant.timezone);
        }
      } catch (err) {
        console.error("summary scheduler tick failed", { pointId: point.id, err });
      }
      await sleep(BETWEEN_POINTS_DELAY_MS);
    }
  }
}

export function startSummaryScheduler() {
  if (intervalHandle) return; // уже запущен — не плодить второй интервал при hot-reload
  intervalHandle = setInterval(() => {
    tick().catch((err) => console.error("summary scheduler tick failed", err));
  }, 60 * 1000);
}
