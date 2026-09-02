/**
 * Проверка правила «размен лежит в кассе, пока кассу не забрали целиком»
 * (решение владельца 2026-09-02 после генеральной проверки финансов).
 *
 * Запуск: npx tsx scripts/check-change-fund-in-till.ts
 *
 * Первая часть читает боевую картину. Вторая прогоняет сценарий внутри
 * транзакции и ОТКАТЫВАЕТ её: на пустой базе отсечка всегда возвращает ноль,
 * и «сходится» ничего не значит. Ошибка в отсечке видна только на данных.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getChangeFundInTillByZone, getPointCashBalance, getPointChangeFundInTill, getZoneBalances } from "../src/lib/zone-balance";
import { buildDailyCashSummaryData } from "../src/lib/summary-channels/daily-cash-data";
import { dayBoundsUtc } from "../src/lib/business-day";
import { getTenantDayContext } from "../src/lib/tenant-day";

function money(n: number) {
  return n.toFixed(2).padStart(10);
}

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`  ${ok ? "ok   " : "ПЛОХО"} ${what}`);
  if (!ok) failures++;
}

const ROLLBACK = "__rollback__";

async function readOnlyPass() {
  const points = await prisma.point.findMany({
    select: { id: true, name: true, tenantId: true, tenant: { select: { name: true } } },
    take: 20,
  });
  const now = new Date();

  for (const point of points) {
    const zones = await prisma.zone.findMany({ where: { pointId: point.id }, select: { id: true, name: true } });
    const [cashNow, fundNow] = await Promise.all([
      getPointCashBalance(point.id),
      getPointChangeFundInTill(point.id),
    ]);
    const { timezone, boundary } = await getTenantDayContext(point.tenantId);
    const bounds = dayBoundsUtc(now.getFullYear(), now.getMonth() + 1, now.getDate(), timezone, boundary);

    console.log(`\n=== ${point.tenant.name} · ${point.name}`);
    console.log(`  касса ${money(cashNow)}   размен ${money(fundNow)}`);

    check(fundNow <= Math.max(0, cashNow) + 0.001, `размен не превышает кассу`);

    const data = await buildDailyCashSummaryData(point.id, bounds, []);
    if (data) {
      check(Math.abs(data.cashOnHand - cashNow) < 0.001, `сводка и остаток сходятся (${data.cashOnHand})`);
    }
    void zones;
  }
}

async function rollbackPass() {
  const zone = await prisma.zone.findFirst({
    // tenantId у зоны нет — он живёт на точке.
    select: { id: true, name: true, pointId: true, point: { select: { name: true, tenantId: true } } },
  });
  if (!zone) {
    console.log("\nНет ни одной зоны — сценарий с откатом пропущен.");
    return;
  }

  console.log(`\n=== сценарий с откатом: ${zone.point.name} · ${zone.name}`);
  const tenantId = zone.point.tenantId;

  await prisma
    .$transaction(async (tx) => {
      const fund = async () => (await getChangeFundInTillByZone([zone.id], tx)).get(zone.id) ?? 0;
      // Остаток именно ЗОНЫ, не точки. Первая версия проверки обнуляла зону на
      // сумму остатка точки — зона уходила в минус, и все дальнейшие ожидания
      // разъезжались. Сама функция при этом работала верно: ужимала размен до
      // реального (отрицательного) остатка.
      const zoneCash = async () => (await getZoneBalances([zone.id], tx)).get(zone.id) ?? 0;

      const cashBefore = await zoneCash();
      const fundBefore = await fund();

      if (cashBefore !== 0) {
        await tx.moneyOperation.create({
          data: { tenantId, zoneId: zone.id, type: "collection", amount: -cashBefore },
        });
      }
      check(Math.abs((await fund()) - 0) < 0.001, `после обнуления кассы размен = 0 (был ${fundBefore})`);

      // 1. Владелец кладёт размен, затем набегает выручка.
      await tx.moneyOperation.create({
        data: { tenantId, zoneId: zone.id, type: "change_fund", amount: 500 },
      });
      await tx.moneyOperation.create({
        data: { tenantId, zoneId: zone.id, type: "revenue", amount: 1000 },
      });
      check(Math.abs((await fund()) - 500) < 0.001, `размен виден: ${await fund()}`);

      // 2. ЧАСТИЧНАЯ инкассация — размен обязан остаться. Раньше обнулялся.
      await tx.moneyOperation.create({
        data: { tenantId, zoneId: zone.id, type: "collection", amount: -1000 },
      });
      check(Math.abs((await fund()) - 500) < 0.001, `частичная инкассация размен не трогает: ${await fund()}`);

      // 3. Забрали больше, чем выручка: размена не может остаться больше,
      //    чем денег в кассе.
      await tx.moneyOperation.create({
        data: { tenantId, zoneId: zone.id, type: "collection", amount: -400 },
      });
      check(Math.abs((await fund()) - 100) < 0.001, `размен ужат до остатка кассы: ${await fund()}`);

      // 4. Забрали всё — размен ушёл вместе с выручкой.
      await tx.moneyOperation.create({
        data: { tenantId, zoneId: zone.id, type: "collection", amount: -100 },
      });
      check(Math.abs(await fund()) < 0.001, `полная инкассация уносит размен: ${await fund()}`);

      // 5. Новый размен после опустошения виден снова и не тянет старый.
      await tx.moneyOperation.create({
        data: { tenantId, zoneId: zone.id, type: "change_fund", amount: 300 },
      });
      check(Math.abs((await fund()) - 300) < 0.001, `новый размен не суммируется со старым: ${await fund()}`);

      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (err instanceof Error && err.message === ROLLBACK) {
        console.log("  транзакция откачена");
        return;
      }
      throw err;
    });

  const leftovers = await prisma.moneyOperation.count({
    where: { zoneId: zone.id, type: "change_fund", amount: { in: [500, 300] } },
  });
  check(leftovers === 0, `следов тестовых операций нет (найдено ${leftovers})`);
}

async function main() {
  await readOnlyPass();
  await rollbackPass();
  console.log(failures === 0 ? "\nВСЁ СОШЛОСЬ" : `\nПРОВАЛОВ: ${failures}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
