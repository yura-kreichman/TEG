/**
 * Разбор размена по одной зоне: печатает журнал с бегущим остатком кассы и
 * тем, сколько размена функция видит в ней на каждом шаге.
 *
 * Запуск: npx tsx scripts/check-change-fund-zone.ts "Игроленд" "Детский лабиринт"
 *
 * Нужен, когда владелец спорит с цифрой на экране: показывает не итог, а
 * КАЖДЫЙ шаг, из которого он сложился, и заодно сверяет результат с тем, что
 * отдают оба экрана — «Остатки и инкассации» владельца и мастер сдачи итогов
 * сотрудника. До 2026-09-02 они считали размен разными формулами и расходились.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { affectsCashOnHand, getZoneChangeFundInTill, getZoneBalances } from "../src/lib/zone-balance";

const [tenantName, zoneName] = process.argv.slice(2);
if (!tenantName || !zoneName) {
  console.error('Использование: npx tsx scripts/check-change-fund-zone.ts "Тенант" "Зона"');
  process.exit(1);
}

function money(n: number) {
  return n.toFixed(2).padStart(11);
}

async function main() {
  const zone = await prisma.zone.findFirst({
    where: { name: zoneName, point: { tenant: { name: tenantName } } },
    select: { id: true, name: true },
  });
  if (!zone) throw new Error(`Зона «${zoneName}» у тенанта «${tenantName}» не найдена`);

  const ops = await prisma.moneyOperation.findMany({
    where: { zoneId: zone.id },
    select: { type: true, amount: true, occurredAt: true },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });

  console.log(`Зона «${zone.name}», операций: ${ops.length}\n`);
  console.log("время".padEnd(20) + "операция".padEnd(22) + "сумма".padStart(11) + "касса".padStart(12) + "размен".padStart(12));

  let balance = 0;
  let fund = 0;
  for (const op of ops) {
    if (!affectsCashOnHand(op.type)) {
      console.log(
        op.occurredAt.toISOString().slice(0, 16).replace("T", " ").padEnd(20) +
          `${op.type} (не в кассе)`.padEnd(22) +
          money(Number(op.amount)) +
          "—".padStart(12) +
          "—".padStart(12)
      );
      continue;
    }
    balance = Math.round((balance + Number(op.amount)) * 100) / 100;
    if (op.type === "change_fund") fund = Math.round((fund + Number(op.amount)) * 100) / 100;
    // Та же обрезка, что в getChangeFundInTillByZone: размена не может быть
    // больше, чем денег в ящике, и проверяется это на КАЖДОЙ операции.
    const before = fund;
    if (fund > balance) fund = Math.max(0, balance);
    const mark = fund !== before ? `  ← обрезан с ${before}` : "";
    console.log(
      op.occurredAt.toISOString().slice(0, 16).replace("T", " ").padEnd(20) +
        op.type.padEnd(22) +
        money(Number(op.amount)) +
        money(balance) +
        money(fund) +
        mark
    );
  }

  const [fromFunction, balances] = await Promise.all([
    getZoneChangeFundInTill(zone.id),
    getZoneBalances([zone.id]),
  ]);
  console.log(`\nПроход выше даёт:      размен ${fund.toFixed(2)}, касса ${balance.toFixed(2)}`);
  console.log(`Функция приложения:    размен ${fromFunction.toFixed(2)}, касса ${(balances.get(zone.id) ?? 0).toFixed(2)}`);
  // Вердикт вычислялся прямо в аргументе console.log и наружу не выходил:
  // «РАСХОЖДЕНИЕ» печаталось, а процесс завершался нулём, и вызов в цепочке
  // принимал молчаливое «не сошлось» за успех. Кладём результат в переменную
  // ради кода возврата — как в check-change-fund-in-till.ts.
  const matches = Math.abs(fromFunction - fund) < 0.005;
  console.log(matches ? "\nСОШЛОСЬ" : "\nРАСХОЖДЕНИЕ — функция считает не так, как проход выше");
  if (!matches) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
