/**
 * Сверка размена по всем зонам тенанта: остаток, невнесённая выручка и то,
 * сколько размена функция видит в ящике.
 *
 * Остаётся в репозитории как регрессионная проверка. Именно она поймала, что
 * первая версия правки 3 сентября врала Игроленду на 750: та прибавляла всю
 * сегодняшнюю выручку к операциям, случившимся ДО неё, и вчерашняя инкассация,
 * забравшая кассу подчистую, переставала обнулять размен. Тестов на эту логику
 * нет — она ходит в базу, — поэтому проверка здесь.
 *
 * Колонка «поправка» показывает, где она вообще нагружена: размен больше
 * журнального остатка бывает ровно тогда, когда в ящике лежит ещё не сданная
 * выручка. Такие зоны и надо разбирать пошагово — check-change-fund-zone.ts.
 *
 * Ничего не пишет, только читает. Можно запускать с боевым DATABASE_URL.
 *
 * Запуск: npx tsx scripts/check-change-fund-pending.ts "Игроленд"
 * Без аргумента — все тенанты сразу.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getChangeFundInTillByZone, getZoneBalances } from "../src/lib/zone-balance";
import { getPendingCashRevenueByZone } from "../src/lib/pending-revenue";

const tenantName = process.argv[2] ?? "";

async function main() {
  const zones = await prisma.zone.findMany({
    where: { point: { tenant: { name: { contains: tenantName } } } },
    select: { id: true, name: true, accountingMode: true, point: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  if (zones.length === 0) throw new Error(`Зон у тенанта «${tenantName}» не найдено`);

  const now = new Date();
  const ids = zones.map((z) => z.id);

  const balances = await getZoneBalances(ids);
  const pending = await getPendingCashRevenueByZone(
    zones.map((z) => ({ id: z.id, accountingMode: z.accountingMode })),
    now
  );
  // Поправка живёт ВНУТРИ функции — отдельного «старого» вызова больше нет,
  // и забыть её ни один экран уже не может.
  const fund = await getChangeFundInTillByZone(ids);

  console.log(
    "зона".padEnd(26) +
      "остаток".padStart(11) +
      "невнесено".padStart(12) +
      "размен".padStart(11) +
      "  поправка"
  );

  let loaded = 0;
  for (const z of zones) {
    const balance = balances.get(z.id) ?? 0;
    const f = fund.get(z.id) ?? 0;
    const works = f > balance;
    if (works) loaded += 1;
    console.log(
      `${z.point.name} · ${z.name}`.slice(0, 25).padEnd(26) +
        balance.toFixed(2).padStart(11) +
        (pending.get(z.id) ?? 0).toFixed(2).padStart(12) +
        f.toFixed(2).padStart(11) +
        (works ? "   нагружена — смотреть глазами" : "   —")
    );
  }

  console.log(
    loaded === 0
      ? "\nНигде размен не превышает журнальный остаток — поправка не нагружена."
      : `\nПоправка нагружена в зонах: ${loaded}. Разобрать пошагово: check-change-fund-zone.ts`
  );

  const fundOps = await prisma.moneyOperation.findMany({
    where: { zoneId: { in: ids }, type: "change_fund" },
    select: { zoneId: true, amount: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  if (fundOps.length > 0) {
    const byId = new Map(zones.map((z) => [z.id, z.name]));
    console.log("\nвнесения размена:");
    for (const op of fundOps) {
      console.log(
        `  ${op.occurredAt.toISOString().slice(0, 16).replace("T", " ")}  ` +
          `${(byId.get(op.zoneId!) ?? "?").padEnd(24)}${Number(op.amount).toFixed(2).padStart(10)}`
      );
    }
  } else {
    console.log("\nвнесений размена нет вовсе.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
