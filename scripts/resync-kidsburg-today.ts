/**
 * РАЗОВЫЙ пересбор сегодняшних сводок КидсБурга — чтобы владелец увидел новое
 * оформление на своих же числах, не дожидаясь завтрашних сдач (его просьба
 * 2026-09-03: «после деплоя разово измени текущие сегодняшние сводки, чтобы я
 * увидел что получилось»).
 *
 * Пересобирает ровно три вида сообщений за сегодняшний бизнес-день:
 * сводки зон, сводки смен и «Кассу за день». Ничего не считает заново — берёт
 * те же данные и прогоняет через новый форматтер. Денег не двигает.
 *
 * НЕ пишет в базу ничего, кроме id пересобранных сообщений (их обновляет сама
 * функция пересборки, если Telegram выдаёт новый id). Правку в CorrectionLog не
 * пишет: это не правка данных, а перерисовка.
 *
 * editedByOwner: false — иначе рядом с именем сотрудника появилась бы корона
 * «правил владелец», а он ничего не правил.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resyncZoneSummaryMessage } from "../src/lib/summary-channels/zone-summary-message";
import { resyncShiftCloseMessage, resyncDailyCashForPoint } from "../src/lib/summary-channels/resync";
import { getTenantDayContext } from "../src/lib/tenant-day";
import { getBusinessDayBounds } from "../src/lib/business-day";

const tenantName = process.argv[2] ?? "КидсБург";

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { name: { contains: tenantName } },
    select: { id: true, name: true, points: { select: { id: true, name: true } } },
  });
  if (!tenant) throw new Error(`Тенант «${tenantName}» не найден`);

  const { timezone, boundary } = await getTenantDayContext(tenant.id);
  const now = new Date();
  const bounds = getBusinessDayBounds(boundary, now, timezone);
  console.log(`${tenant.name}: бизнес-день ${bounds.start.toISOString()} … ${bounds.end.toISOString()}`);

  const submissions = await prisma.zoneSubmission.findMany({
    where: {
      zone: { point: { tenantId: tenant.id } },
      createdAt: { gte: bounds.start, lt: bounds.end },
      telegramSummaryMessageId: { not: null },
    },
    select: { id: true, zone: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const zs of submissions) {
    await resyncZoneSummaryMessage(zs.id, tenant.id, { editedByOwner: false });
    console.log(`  зона «${zs.zone.name}» — пересобрана`);
  }
  if (submissions.length === 0) console.log("  сводок зон за сегодня нет");

  const shifts = await prisma.shift.findMany({
    where: {
      tenantId: tenant.id,
      startAt: { gte: bounds.start, lt: bounds.end },
      telegramSummaryMessageId: { not: null },
      endAt: { not: null },
    },
    select: { id: true, operator: { select: { name: true } } },
    orderBy: { startAt: "asc" },
  });
  for (const shift of shifts) {
    await resyncShiftCloseMessage(shift.id);
    console.log(`  смена «${shift.operator.name}» — пересобрана`);
  }
  if (shifts.length === 0) console.log("  сводок смен за сегодня нет");

  for (const point of tenant.points) {
    await resyncDailyCashForPoint(point.id, tenant.id, now);
    console.log(`  «Касса за день» точки «${point.name}» — пересобрана`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
