import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { localMinutesOfDay } from "../src/lib/business-day";

/**
 * Приводит Tenant.businessDayBoundary к двум значениям, за которыми теперь
 * стоит тумблер "Работаете после полуночи?" (решение пользователя 2026-08-06):
 * "00:00" — нет, "06:00" — да.
 *
 * Ответ НЕ угадывается: для каждого тенанта смотрим, была ли за всё время хоть
 * одна операция в ночные часы (с полуночи до NIGHT_END по его поясу). Если не
 * было ни одной — ставим полночь, и его числа в отчётах не сдвинутся ни на
 * копейку, потому что в этих часах у него пусто. Если была — ставим 06:00.
 *
 * Заодно лечится 22:00 у одного из тенантов на проде: при закрытии в 20:10 это
 * тикающая мина — любая задержавшаяся сдача уехала бы в следующий день.
 *
 * Идемпотентен, читает и печатает решение по каждому тенанту. --apply, чтобы
 * записать; без него — только отчёт.
 */
const NIGHT_END_MINUTES = 6 * 60;
const MIDNIGHT = "00:00";
const NIGHT_BOUNDARY = "06:00";

async function main() {
  const apply = process.argv.includes("--apply");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, timezone: true, businessDayBoundary: true },
    orderBy: { name: "asc" },
  });

  for (const tenant of tenants) {
    const tz = tenant.timezone ?? "UTC";

    // Ночные часы ищем по тем событиям, которые вообще означают "точка
    // работала": сдача итогов, смена, пуск, продажа товара. Денежные операции
    // сюда не годятся — инкассацию/расход владелец может внести ночью из дома,
    // и это не значит, что точка работала.
    const [submissions, shifts, launches, goodsSales] = await Promise.all([
      prisma.resultsSubmission.findMany({
        where: { point: { tenantId: tenant.id } },
        select: { submittedAt: true },
      }),
      prisma.shift.findMany({ where: { point: { tenantId: tenant.id } }, select: { startAt: true, endAt: true } }),
      prisma.launch.findMany({
        where: { zone: { point: { tenantId: tenant.id } } },
        select: { startedAt: true, endedAt: true },
      }),
      prisma.goodsSale.findMany({ where: { tenantId: tenant.id }, select: { occurredAt: true } }),
    ]);

    const moments: Date[] = [
      ...submissions.map((s) => s.submittedAt),
      ...shifts.flatMap((s) => [s.startAt, ...(s.endAt ? [s.endAt] : [])]),
      ...launches.flatMap((l) => [l.startedAt, ...(l.endedAt ? [l.endedAt] : [])]),
      ...goodsSales.map((g) => g.occurredAt),
    ];

    const nightMoments = moments.filter((m) => localMinutesOfDay(m, tz) < NIGHT_END_MINUTES);
    const worksPastMidnight = nightMoments.length > 0;
    const next = worksPastMidnight ? NIGHT_BOUNDARY : MIDNIGHT;

    const latest = moments.length
      ? moments.reduce((a, b) => (a > b ? a : b))
      : null;
    const latestLocal = latest
      ? `${String(Math.floor(localMinutesOfDay(latest, tz) / 60)).padStart(2, "0")}:${String(
          localMinutesOfDay(latest, tz) % 60
        ).padStart(2, "0")}`
      : "—";

    console.log(
      [
        tenant.name.padEnd(18),
        `было ${tenant.businessDayBoundary}`.padEnd(14),
        `станет ${next}`.padEnd(14),
        `ночных событий: ${nightMoments.length}`.padEnd(22),
        `всего событий: ${moments.length}`.padEnd(20),
        `последнее по месту: ${latestLocal}`,
      ].join(" ")
    );

    if (apply && tenant.businessDayBoundary !== next) {
      await prisma.tenant.update({ where: { id: tenant.id }, data: { businessDayBoundary: next } });
      console.log(`  -> записано`);
    }
  }

  if (!apply) console.log("\nЭто отчёт. Запусти с --apply, чтобы записать.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
