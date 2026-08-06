import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { businessDayOf } from "../src/lib/business-day";

/**
 * Проверка перед деплоем перехода кабинета на бизнес-день (решение пользователя
 * 2026-08-06): за последние N дней раскладывает сдачи итогов двумя способами —
 * по календарному дню (как считал кабинет до сих пор) и по бизнес-дню (как
 * будет) — и печатает ТОЛЬКО расхождения.
 *
 * Ноль расхождений = ни у кого не было ночных сдач, переключение никому не
 * сдвинет числа за прошлые дни. Есть расхождения = сразу видно у кого, за какую
 * дату и на какую сумму, и можно сказать об этом заранее, а не узнавать по
 * жалобе.
 *
 * Читает только, ничего не пишет.
 */
const DAYS = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30);

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, timezone: true, businessDayBoundary: true },
    orderBy: { name: "asc" },
  });

  let total = 0;
  for (const tenant of tenants) {
    const tz = tenant.timezone ?? "UTC";
    const boundary = tenant.businessDayBoundary ?? "00:00";

    const submissions = await prisma.resultsSubmission.findMany({
      where: { point: { tenantId: tenant.id }, submittedAt: { gte: since } },
      select: {
        submittedAt: true,
        point: { select: { name: true } },
        zoneSubmissions: { select: { cashAmount: true, mobileAmount: true, zone: { select: { name: true } } } },
      },
      orderBy: { submittedAt: "asc" },
    });

    const rows = submissions
      .map((s) => {
        const calendar = dateKey(businessDayOf(s.submittedAt, tz, "00:00"));
        const business = dateKey(businessDayOf(s.submittedAt, tz, boundary));
        const amount = s.zoneSubmissions.reduce(
          (sum, zs) => sum + Number(zs.cashAmount) + Number(zs.mobileAmount),
          0
        );
        return { s, calendar, business, amount };
      })
      .filter((r) => r.calendar !== r.business);

    if (rows.length === 0) continue;
    total += rows.length;

    console.log(`\n${tenant.name}  (пояс ${tz}, граница ${boundary})`);
    for (const r of rows) {
      console.log(
        `  ${r.s.submittedAt.toISOString()}  ${r.s.point.name}  ${r.calendar} -> ${r.business}  ${r.amount.toFixed(2)}  ` +
          `(${r.s.zoneSubmissions.map((zs) => zs.zone.name).join(", ")})`
      );
    }
  }

  console.log(
    total === 0
      ? `\nРасхождений нет за ${DAYS} дней — переключение не сдвинет ни одной сдачи.`
      : `\nВсего расхождений: ${total} за ${DAYS} дней.`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
