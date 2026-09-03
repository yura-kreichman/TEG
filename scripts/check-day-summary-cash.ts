/**
 * Сверка итога дня: сколько наличных сводка считает за день и из чего они
 * складываются.
 *
 * Вопрос владельца 2026-09-03: «в Итогах дня 2 сентября у КидсБурга наличных
 * 2945, хотя по факту было больше — там не учтена инкассация 5350». Так и было:
 * итог складывал только сданное сотрудником. Проверка печатает оба слагаемых и
 * сумму, чтобы это можно было увидеть, а не обсуждать.
 *
 * Ничего не пишет, только читает. Запуск:
 *   npx tsx scripts/check-day-summary-cash.ts "КидсБург" 2026-09-02
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildDailyCashSummaryData } from "../src/lib/summary-channels/daily-cash-data";
import { getTenantDayContext } from "../src/lib/tenant-day";
import { getBusinessDayBounds } from "../src/lib/business-day";

const [tenantName, dayArg] = process.argv.slice(2);

async function main() {
  const points = await prisma.point.findMany({
    where: { tenant: { name: { contains: tenantName ?? "" } } },
    select: { id: true, name: true, tenantId: true, tenant: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  if (points.length === 0) throw new Error(`Точек у тенанта «${tenantName}» не найдено`);

  for (const point of points) {
    const { timezone, boundary } = await getTenantDayContext(point.tenantId);
    const anchor = dayArg ? new Date(`${dayArg}T12:00:00Z`) : new Date();
    const bounds = getBusinessDayBounds(boundary, anchor, timezone);

    const data = await buildDailyCashSummaryData(point.id, bounds, []);
    if (!data) {
      console.log(`${point.tenant.name} · ${point.name}: данных нет`);
      continue;
    }

    const cashTotal = Math.round((data.cashAmount + data.collectedDuringDay) * 100) / 100;
    console.log(`\n${point.tenant.name} · ${point.name}`);
    console.log(`  сдано сотрудником налом : ${data.cashAmount.toFixed(2)}`);
    console.log(`  забрано инкассацией днём: ${data.collectedDuringDay.toFixed(2)}`);
    console.log(`  ВЫРУЧКА НАЛОМ ЗА ДЕНЬ   : ${cashTotal.toFixed(2)}`);
    console.log(`  безнал                  : ${data.mobileAmount.toFixed(2)}`);
    console.log(`  расходы                 : ${data.expenses.toFixed(2)}`);
    console.log(`  премии и авансы         : ${data.bonusesAndAdvances.toFixed(2)}`);
    console.log(`  наличных в кассе        : ${data.cashOnHand.toFixed(2)}`);
    if (data.zoneBreakdown.length > 0) {
      console.log("  по зонам:");
      let sum = 0;
      for (const z of data.zoneBreakdown) {
        sum += z.revenue;
        console.log(`    ${z.zoneName.padEnd(22)}${z.revenue.toFixed(2).padStart(10)}`);
      }
      const expected = Math.round((cashTotal + data.mobileAmount) * 100) / 100;
      const got = Math.round(sum * 100) / 100;
      console.log(
        got === expected
          ? `    строки сходятся с итогом (${got.toFixed(2)})`
          : `    НЕ СХОДЯТСЯ: строки ${got.toFixed(2)} против итога ${expected.toFixed(2)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
