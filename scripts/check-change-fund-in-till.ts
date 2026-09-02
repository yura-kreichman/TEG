/**
 * Проверка расчётов «Наличных в кассе» / «Размен в кассе» и того, что сборка
 * данных Telegram-сводки «Касса за день» не сломалась после правок 2026-09-02.
 *
 * Запуск: npx tsx scripts/check-change-fund-in-till.ts
 *
 * Первая часть только читает боевую картину. Вторая создаёт размен и
 * инкассацию внутри транзакции и ОТКАТЫВАЕТ её — иначе отсечки проверить
 * нечем: на пустой базе они всегда возвращают ноль и «сходится» ничего не
 * значит. Ошибка в отсечке видна только на данных, типы её не ловят.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  getChangeFundInTillByZone,
  getPointCashBalance,
  getPointChangeFundInTill,
  getZoneChangeFundInTill,
} from "../src/lib/zone-balance";
import { buildDailyCashSummaryData } from "../src/lib/summary-channels/daily-cash-data";
import { dayBoundsUtc } from "../src/lib/business-day";
import { getTenantDayContext } from "../src/lib/tenant-day";

function money(n: number) {
  return n.toFixed(2).padStart(12);
}

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`  ${ok ? "ok  " : "ПЛОХО"} ${what}`);
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
    const [cashNow, fundNow, byZone] = await Promise.all([
      getPointCashBalance(point.id),
      getPointChangeFundInTill(point.id),
      getChangeFundInTillByZone(zones.map((z) => z.id)),
    ]);

    // Часовой пояс и границу суток берём тем же помощником, что и сам роут,
    // а не своим чтением тенанта: разойдись они, проверка сверяла бы другой
    // день, и «сходится» ничего бы не значило.
    const { timezone, boundary } = await getTenantDayContext(point.tenantId);
    const bounds = dayBoundsUtc(now.getFullYear(), now.getMonth() + 1, now.getDate(), timezone, boundary);
    const [cashAsOf, fundAsOf] = await Promise.all([
      getPointCashBalance(point.id, prisma, bounds.end),
      getPointChangeFundInTill(point.id, prisma, bounds.end),
    ]);

    console.log(`\n=== ${point.tenant.name} · ${point.name}`);
    console.log(`  касса ${money(cashNow)} / на конец дня ${money(cashAsOf)}`);
    console.log(`  размен ${money(fundNow)} / на конец дня ${money(fundAsOf)}`);
    for (const zone of zones) {
      const fund = byZone.get(zone.id) ?? 0;
      if (fund !== 0) console.log(`    · ${zone.name}: ${money(fund)}`);
    }

    // Сборка данных сводки — самое хрупкое место: она ходит в
    // getPointCashBalance и сломалась бы, разъедься сигнатура.
    const data = await buildDailyCashSummaryData(point.id, bounds, []);
    if (!data) {
      console.log(`  сводка: точка не найдена`);
      continue;
    }
    check(
      Math.abs(data.cashOnHand - cashNow) < 0.001,
      `сводка и остаток сходятся (${data.cashOnHand} = ${cashNow})`
    );
  }
}

async function rollbackPass() {
  const zone = await prisma.zone.findFirst({
    where: { point: { is: {} } },
    // tenantId у зоны нет — он живёт на точке.
    select: { id: true, name: true, pointId: true, point: { select: { name: true, tenantId: true } } },
  });
  if (!zone) {
    console.log("\nНет ни одной зоны — сценарий с откатом пропущен.");
    return;
  }

  console.log(`\n=== сценарий с откатом: ${zone.point.name} · ${zone.name}`);

  await prisma
    .$transaction(async (tx) => {
      const cashBefore = await getPointCashBalance(zone.pointId, tx);
      const fundBefore = await getZoneChangeFundInTill(zone.id, tx);

      // 1. Владелец кладёт размен.
      await tx.moneyOperation.create({
        data: { tenantId: zone.point.tenantId, zoneId: zone.id, type: "change_fund", amount: 500 },
      });
      const cashWithFund = await getPointCashBalance(zone.pointId, tx);
      const fundWithFund = await getZoneChangeFundInTill(zone.id, tx);
      check(Math.abs(fundWithFund - (fundBefore + 500)) < 0.001, `размен виден: ${fundWithFund}`);
      check(Math.abs(cashWithFund - (cashBefore + 500)) < 0.001, `размен вошёл в кассу: ${cashWithFund}`);

      // 2. Инкассация БЕЗ возврата размена — он должен исчезнуть.
      const collected = await tx.moneyOperation.create({
        data: { tenantId: zone.point.tenantId, zoneId: zone.id, type: "collection", amount: -cashWithFund },
      });
      const fundAfterPlain = await getZoneChangeFundInTill(zone.id, tx);
      check(Math.abs(fundAfterPlain) < 0.001, `инкассация унесла размен: ${fundAfterPlain}`);

      // 3. Возврат размена «на секунду позже» — как это делает роут. Главное,
      //    что тут проверяется: метка не совпадает с инкассацией и размен не
      //    отменяет сам себя на границе отсечки (сравнение через <=).
      await tx.moneyOperation.create({
        data: {
          tenantId: zone.point.tenantId,
          zoneId: zone.id,
          type: "change_fund",
          amount: 500,
          occurredAt: new Date(collected.occurredAt.getTime() + 1000),
        },
      });
      const fundKept = await getZoneChangeFundInTill(zone.id, tx);
      check(Math.abs(fundKept - 500) < 0.001, `«оставить размен» вернул его: ${fundKept}`);

      // 4. И тот же размен, но метка В ТУ ЖЕ миллисекунду — так было бы без
      //    сдвига. Ожидаем, что он пропадёт: это и есть та ловушка, ради
      //    которой сдвиг сделан.
      await tx.moneyOperation.create({
        data: {
          tenantId: zone.point.tenantId,
          zoneId: zone.id,
          type: "change_fund",
          amount: 700,
          occurredAt: collected.occurredAt,
        },
      });
      const fundSameMs = await getZoneChangeFundInTill(zone.id, tx);
      check(
        Math.abs(fundSameMs - 500) < 0.001,
        `размен с меткой инкассации отсекается, сдвиг на секунду обязателен: ${fundSameMs}`
      );

      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (err instanceof Error && err.message === ROLLBACK) {
        console.log("  транзакция откачена, в базе ничего не осталось");
        return;
      }
      throw err;
    });

  // Убеждаемся, что откат действительно случился.
  const leftovers = await prisma.moneyOperation.count({
    where: { zoneId: zone.id, type: "change_fund", amount: { in: [500, 700] } },
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
