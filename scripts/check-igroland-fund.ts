/**
 * Разовая сверка размена Игроленда: что даёт СТАРАЯ формула (обрезка по
 * журнальному остатку) против НОВОЙ (обрезка по содержимому ящика, то есть
 * остаток плюс невнесённая выручка).
 *
 * Остаётся в репозитории как регрессионная проверка: именно она поймала, что
 * первая версия правки 3 сентября врала Игроленду на 750 — прибавляла всю
 * сегодняшнюю выручку к операциям, случившимся ДО неё, и вчерашняя инкассация
 * переставала обнулять размен. Тестов на эту логику нет (она ходит в базу),
 * поэтому проверка — здесь: запусти с боевым DATABASE_URL и смотри колонку
 * «расхождение». Ничего не пишет, только читает.
 *
 * Запуск: npx tsx scripts/check-igroland-fund.ts "Игроленд"
 * Без аргумента — все тенанты сразу (пустая строка тоже годится).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getChangeFundInTillByZone, getZoneBalances } from "../src/lib/zone-balance";
import { getPendingCashRevenueByZone, getPendingCashRevenueEventsByZone } from "../src/lib/pending-revenue";
import { previousSubmissionBoundary } from "../src/lib/game-room";

const tenantName = process.argv[2] ?? "Игроленд";

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
  const zoneArgs = zones.map((z) => ({ id: z.id, accountingMode: z.accountingMode }));
  const pending = await getPendingCashRevenueByZone(zoneArgs, now);
  const events = await getPendingCashRevenueEventsByZone(zoneArgs, now);
  const window = new Map<string, Date | null>();
  for (const z of zones) window.set(z.id, await previousSubmissionBoundary(z.id));

  const oldFund = await getChangeFundInTillByZone(ids);
  const newFund = await getChangeFundInTillByZone(ids, undefined, undefined, events);

  console.log(
    "зона".padEnd(24) +
      "остаток".padStart(11) +
      "невнесено".padStart(12) +
      "размен СТАРО".padStart(14) +
      "размен НОВО".padStart(13) +
      "  расхождение"
  );
  let diverged = 0;
  for (const z of zones) {
    const a = oldFund.get(z.id) ?? 0;
    const b = newFund.get(z.id) ?? 0;
    if (a !== b) diverged += 1;
    console.log(
      `${z.point.name} · ${z.name}`.slice(0, 23).padEnd(24) +
        (balances.get(z.id) ?? 0).toFixed(2).padStart(11) +
        (pending.get(z.id) ?? 0).toFixed(2).padStart(12) +
        a.toFixed(2).padStart(14) +
        b.toFixed(2).padStart(13) +
        (a !== b ? `   ${(b - a).toFixed(2)}` : "   —")
    );
  }
  console.log(
    diverged === 0
      ? "\nФормулы совпали во всех зонах — правка ничего не сдвинула."
      : `\nРАСХОЖДЕНИЯ в ${diverged} зонах — смотреть, какая из формул права.`
  );

  const fundOps = await prisma.moneyOperation.findMany({
    where: { zoneId: { in: ids }, type: "change_fund" },
    select: { zoneId: true, amount: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  if (fundOps.length > 0) {
    console.log("\nвнесения размена:");
    const byId = new Map(zones.map((z) => [z.id, z.name]));
    for (const op of fundOps) {
      console.log(
        `  ${op.occurredAt.toISOString().slice(0, 16).replace("T", " ")}  ` +
          `${(byId.get(op.zoneId!) ?? "?").padEnd(22)}${Number(op.amount).toFixed(2).padStart(10)}`
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
