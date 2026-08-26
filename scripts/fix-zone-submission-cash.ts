import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { getZoneSubmissionEditability } from "../src/lib/results-submission";

/**
 * Правка кассы уже сданной зоны из командной строки — тем же набором
 * действий, что делает владелец кнопкой в «Итогах по дням» (PATCH
 * /api/reports/counters/zone-submission/[id]): сумма на самой сдаче,
 * денежные операции журнала, запись в журнал правок и пересборка сообщения
 * в Telegram.
 *
 * Зачем отдельно от кабинета: 2026-08-26 сотрудник Керен Центра сдал итоги
 * по зоне «Халабуда» (режим «Прибывания») с нулевой кассой, а правка таких
 * сдач тогда была закрыта наглухо — исправить в интерфейсе было нечем.
 * Правку кассы живым зонам открыли тем же днём, но сама сдача осталась
 * нулевой до выката.
 *
 *   npx tsx scripts/fix-zone-submission-cash.ts <zoneSubmissionId> <нал> <безнал> ["причина"] [--dry]
 */
const [, , zoneSubmissionId, cashArg, mobileArg, reasonArg] = process.argv;
const dryRun = process.argv.includes("--dry");

if (!zoneSubmissionId || cashArg === undefined || mobileArg === undefined) {
  console.error("Использование: npx tsx scripts/fix-zone-submission-cash.ts <zoneSubmissionId> <нал> <безнал> [причина] [--dry]");
  process.exit(1);
}

const nextCash = Number(cashArg);
const nextMobile = Number(mobileArg);
if (![nextCash, nextMobile].every((n) => Number.isFinite(n) && n >= 0)) {
  console.error("Суммы должны быть неотрицательными числами");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const zs = await prisma.zoneSubmission.findUnique({
    where: { id: zoneSubmissionId },
    include: {
      zone: { include: { point: { include: { tenant: { select: { name: true } } } } } },
      assetReadings: { select: { assetId: true, tariffId: true, reading: true } },
      resultsSubmission: { include: { operator: { select: { name: true } } } },
    },
  });
  if (!zs) throw new Error(`Сдача ${zoneSubmissionId} не найдена`);

  const tenantId = zs.zone.point.tenantId;
  const editability = await getZoneSubmissionEditability(zs.id, zs.zone.accountingMode);
  if (!editability.canEditCash) {
    throw new Error("Касса этой сдачи не правится: есть более поздняя сдача по активам зоны");
  }

  // Владелец правит от своего имени — операции журнала должны быть подписаны
  // им, как и при правке через кабинет (performedByUserId), иначе в Деньгах
  // появится выручка без автора.
  const owner = await prisma.user.findFirst({ where: { tenantId, role: "owner" }, select: { id: true, email: true } });
  if (!owner) throw new Error("У тенанта нет владельца — некому приписать правку");

  const before = {
    cashAmount: Number(zs.cashAmount),
    mobileAmount: Number(zs.mobileAmount),
    returnsCount: zs.returnsCount,
    readings: Object.fromEntries(zs.assetReadings.map((r) => [`${r.assetId}:${r.tariffId}`, r.reading])),
  };
  const after = { ...before, cashAmount: nextCash, mobileAmount: nextMobile };

  console.log(`Тенант: ${zs.zone.point.tenant.name} · точка: ${zs.zone.point.name} · зона: ${zs.zone.name} (${zs.zone.accountingMode})`);
  console.log(`Сотрудник: ${zs.resultsSubmission.operator.name} · сдача от ${zs.resultsSubmission.submittedAt.toISOString()}`);
  console.log(`Наличные: ${before.cashAmount} → ${nextCash}`);
  console.log(`Безнал:   ${before.mobileAmount} → ${nextMobile}`);

  if (dryRun) {
    console.log("--dry: ничего не записано");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.zoneSubmission.update({
      where: { id: zs.id },
      data: { cashAmount: nextCash, mobileAmount: nextMobile },
    });

    // Те же две операции журнала и та же логика создать/обновить/удалить, что
    // в PATCH-роуте: при нулевой сдаче их не существует вовсе, поэтому здесь
    // именно создание, а не обновление.
    for (const [type, amount] of [
      ["revenue", nextCash],
      ["revenue_cashless", nextMobile],
    ] as const) {
      const existing = await tx.moneyOperation.findFirst({
        where: { resultsSubmissionId: zs.resultsSubmissionId, zoneId: zs.zoneId, type },
      });
      if (amount > 0) {
        if (existing) await tx.moneyOperation.update({ where: { id: existing.id }, data: { amount } });
        else
          await tx.moneyOperation.create({
            data: {
              tenantId,
              zoneId: zs.zoneId,
              type,
              amount,
              performedByUserId: owner.id,
              resultsSubmissionId: zs.resultsSubmissionId,
            },
          });
      } else if (existing) {
        await tx.moneyOperation.delete({ where: { id: existing.id } });
      }
    }

    await tx.correctionLog.create({
      data: {
        entityType: "ZoneSubmission",
        entityId: zs.id,
        correctedByUserId: owner.id,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify(after)),
        comment: reasonArg && !reasonArg.startsWith("--") ? reasonArg : null,
      },
    });
  });
  console.log("Касса и журнал обновлены");

  // Сообщение в Telegram и «Касса за день» — тем же кодом, что и правка из
  // кабинета. Импорт отложенный: модуль тянет свой экземпляр prisma.
  const { resyncZoneSummaryMessage } = await import("../src/lib/summary-channels/zone-summary-message");
  const { resyncDailyCashForZone } = await import("../src/lib/summary-channels/resync");
  await resyncZoneSummaryMessage(zs.id, tenantId);
  console.log("Сводка по зоне в Telegram обновлена");
  await resyncDailyCashForZone(zs.zoneId, tenantId, zs.createdAt);
  console.log("«Касса за день» пересобрана");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
