/**
 * Разовая починка данных КидсБурга за 2 сентября 2026.
 *
 * Запуск (сначала обязательно без --apply):
 *   npx tsx scripts/repair-kidsburg-2026-09-02.ts
 *   npx tsx scripts/repair-kidsburg-2026-09-02.ts --apply
 *
 * ЧТО ЧИНИМ
 *
 * 1. Владелец забрал кассу среди дня, до сдачи итогов. Сегодняшняя выручка
 *    попадает в журнал только вечером, поэтому инкассация увела остатки зон в
 *    минус, а сотрудник вечером ввёл то, что физически осталось в ящике:
 *
 *      Батуты      16:26 −305, 18:17 −2000, сдача +70   → остаток −1930
 *      Виртуалка   16:26 −130, 18:21 −350,  сдача +450  → остаток   100
 *      Машинки     16:26 −985, 18:35 −3000, сдача +2425 → остаток  −575
 *
 *    Правило, которое теперь действует на будущее (getZoneCollectionOverdraw),
 *    прибавляет забранное сверх остатка к выручке сдачи. Эта сдача прошла на
 *    старом коде, сама себя не вылечит — дописываем недостающую выручку.
 *
 * 2. Авансы и премии, внесённые владельцем из карточек в 20:36–20:37
 *    (200 + 800 + 800 + 200 = 2000), несут только performedByUserId, а по
 *    прежнему правилу это означало «деньги не из кассы точки». Владелец
 *    подтвердил 2026-09-02, что выдавал их из ящика: сотрудник прислал в чат
 *    остаток 425 + 70 + 450 = 945, то есть ровно на 2000 меньше расчётного.
 *    Проставляем performedByOperatorId и разносим по зонам — ровно то, что
 *    теперь делают сами роуты для новых записей.
 *
 * ПОСЛЕ починки остатки зон должны стать 2425 / 70 / 450 минус разнесённые
 * 2000, то есть в сумме 945 — как в чате.
 *
 * Скрипт идемпотентен: повторный запуск видит уже дописанные строки по
 * пометке в comment и ничего не делает.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getZoneBalances, chargeSelfServiceAdvanceToZones } from "../src/lib/zone-balance";
import { resyncZoneSummaryMessage } from "../src/lib/summary-channels/zone-summary-message";
import { resyncDailyCashForZone } from "../src/lib/summary-channels/resync";
import { computeZoneSubmissionRevenues } from "../src/lib/reports";

const APPLY = process.argv.includes("--apply");
const MARK = "repair-2026-09-02";
const TENANT = "КидсБург";

// Забранное сверх остатка зоны — посчитано проходом по журналу (см. разбор в
// шапке). Числа зашиты намеренно: это разовая починка конкретного дня, а не
// общий механизм, и пересчитывать их на живых данных, которые сам же скрипт
// и меняет, — верный способ дописать лишнее при повторном запуске.
const OVERDRAWN: Record<string, number> = {
  Батуты: 2000,
  Виртуалка: 350,
  Машинки: 3000,
};

function money(n: number) {
  return n.toFixed(2).padStart(10);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: TENANT }, select: { id: true } });
  if (!tenant) throw new Error(`Тенант «${TENANT}» не найден`);

  const zones = await prisma.zone.findMany({
    where: { name: { in: Object.keys(OVERDRAWN) }, point: { tenantId: tenant.id } },
    select: { id: true, name: true, pointId: true },
  });
  if (zones.length !== Object.keys(OVERDRAWN).length) {
    throw new Error(`Найдено зон: ${zones.length}, ожидалось ${Object.keys(OVERDRAWN).length}`);
  }
  const pointId = zones[0]!.pointId;

  // Сдача 2 сентября — к ней привязываем дописанную выручку, чтобы «Итоги
  // дня» и сводки увидели её в том же окне, а не отдельной строкой ниоткуда.
  const submission = await prisma.resultsSubmission.findFirst({
    where: { tenantId: tenant.id, submittedAt: { gte: new Date("2026-09-02T00:00:00Z") } },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedAt: true },
  });
  if (!submission) throw new Error("Сдача за 2 сентября не найдена");

  const already = await prisma.moneyOperation.count({
    where: { tenantId: tenant.id, comment: { contains: MARK } },
  });
  if (already > 0) {
    console.log(`Починка уже выполнена: найдено ${already} строк с пометкой «${MARK}». Выходим.`);
    return;
  }

  const before = await getZoneBalances(zones.map((z) => z.id));
  console.log(APPLY ? "=== РЕЖИМ ЗАПИСИ ===" : "=== ПРОБНЫЙ ПРОГОН (без --apply ничего не пишется) ===");
  console.log("\nОстатки зон СЕЙЧАС:");
  for (const z of zones) console.log(`  ${z.name.padEnd(12)} ${money(before.get(z.id) ?? 0)}`);

  const payouts = await prisma.moneyOperation.findMany({
    where: {
      tenantId: tenant.id,
      type: { in: ["advance", "bonus_payout"] },
      occurredAt: { gte: new Date("2026-09-02T20:30:00Z") },
      performedByOperatorId: null,
      beneficiaryOperatorId: { not: null },
    },
    select: { id: true, amount: true, beneficiaryOperatorId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  console.log(`\nВыплат из карточек без пометки «из рук сотрудника»: ${payouts.length}`);
  for (const p of payouts) console.log(`  ${p.occurredAt.toISOString()} ${money(Number(p.amount))}`);

  const plannedTotal = Object.values(OVERDRAWN).reduce((s, v) => s + v, 0);
  const payoutTotal = payouts.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  console.log(`\nДопишем выручки: ${money(plannedTotal)}`);
  console.log(`Разнесём выплат: ${money(payoutTotal)}`);
  console.log(`Ожидаемая сумма остатков после починки: ${money(2425 + 70 + 450 - payoutTotal)}`);

  await showDifference("Разница СЕЙЧАС", submission.submittedAt, zones);

  if (!APPLY) {
    console.log("\nПробный прогон окончен. Для записи — тот же вызов с --apply.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pointId}))`;

    for (const zone of zones) {
      const amount = OVERDRAWN[zone.name]!;
      // Выручка — чинит ОСТАТОК зоны.
      await tx.moneyOperation.create({
        data: {
          tenantId: tenant.id,
          zoneId: zone.id,
          type: "revenue",
          amount,
          resultsSubmissionId: submission.id,
          occurredAt: submission.submittedAt,
          comment: `Выручка, забранная инкассацией до пересчёта (${MARK})`,
        },
      });
      // Поле в самой сдаче — чинит РАЗНИЦУ. Двойного счёта нет: остаток зоны
      // считается по журналу, а Разница — по cashAmount сдачи плюс это поле,
      // и cashAmount мы не трогаем. Ровно то, что записала бы сама сдача,
      // пройди она уже на исправленном коде.
      await tx.zoneSubmission.updateMany({
        where: { resultsSubmissionId: submission.id, zoneId: zone.id },
        data: { collectedBeforeSubmission: amount },
      });
    }

    // Выплаты: помечаем «ушли из рук сотрудника» и разносим по зонам — тем же
    // вызовом, что теперь делают роуты карточки.
    for (const p of payouts) {
      await tx.moneyOperation.update({
        where: { id: p.id },
        data: {
          performedByOperatorId: p.beneficiaryOperatorId,
          comment: `Выдано из кассы точки (${MARK})`,
        },
      });
      await chargeSelfServiceAdvanceToZones(
        tenant.id,
        pointId,
        Math.abs(Number(p.amount)),
        p.beneficiaryOperatorId!,
        tx
      );
    }
  });

  const after = await getZoneBalances(zones.map((z) => z.id));
  console.log("\nОстатки зон ПОСЛЕ:");
  let sum = 0;
  for (const z of zones) {
    const v = after.get(z.id) ?? 0;
    sum += v;
    console.log(`  ${z.name.padEnd(12)} ${money(v)}`);
  }
  console.log(`  ${"ИТОГО".padEnd(12)} ${money(sum)}`);

  // Пересобираем уже отправленные сообщения: сводку по каждой зоне и «Кассу
  // за день». Иначе в чате останутся старые числа, и владелец увидит
  // расхождение между приложением и Telegram.
  const zoneSubmissions = await prisma.zoneSubmission.findMany({
    where: { resultsSubmissionId: submission.id },
    select: { id: true, zoneId: true },
  });
  for (const zs of zoneSubmissions) {
    await resyncZoneSummaryMessage(zs.id, tenant.id, { editedByOwner: true }).catch((e) =>
      console.error("  сводка по зоне не пересобралась:", e?.message ?? e)
    );
  }
  await resyncDailyCashForZone(zones[0]!.id, tenant.id, submission.submittedAt).catch((e) =>
    console.error("  «Касса за день» не пересобралась:", e?.message ?? e)
  );
  console.log("\nСообщения в Telegram пересобраны.");

  await showDifference("Разница ПОСЛЕ", submission.submittedAt, zones);
}

/** Разница по каждой зоне — той же функцией, что и все отчёты владельца. */
async function showDifference(title: string, at: Date, zones: { id: string; name: string }[]) {
  const from = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(at.getTime() + 24 * 60 * 60 * 1000);
  const rows = await computeZoneSubmissionRevenues(
    zones.map((z) => z.id),
    from,
    to
  );
  const byZone = new Map(zones.map((z) => [z.id, z.name]));
  console.log(`\n${title}:`);
  let total = 0;
  for (const r of rows) {
    total += r.difference;
    console.log(
      `  ${(byZone.get(r.zoneId) ?? r.zoneId).padEnd(12)} расчётная ${money(r.calculatedRevenue)}   Разница ${money(r.difference)}`
    );
  }
  console.log(`  ${"ИТОГО".padEnd(12)} ${" ".repeat(21)}${money(total)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
