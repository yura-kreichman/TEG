/**
 * Пересборка уже отправленных сводок «Закрытие смены» за один день.
 *
 * Запуск: npx tsx scripts/resync-shift-summaries.ts "КидсБург" 2026-09-02
 *
 * Зачем разово: формат сводки поменялся (появились «Ставка» и «Начислено за
 * смену» — запрос владельца 2026-09-03), а уже висящие в чате сообщения сами
 * не перерисовываются: их трогает только правка смены или её аванса.
 *
 * Ошибки НЕ глушим — resyncShiftCloseMessage внутри ловит всё в try/catch и
 * молчит, поэтому здесь печатаем состояние до и после: id сообщения, ставку,
 * начисление и итог. Если сообщение не поменялось, будет видно почему.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resyncShiftCloseMessage } from "../src/lib/summary-channels/resync";
import { calcShiftAccrual, getRateForDate, calcOperatorBalance } from "../src/lib/work-time";

const [tenantName, day] = process.argv.slice(2);
if (!tenantName || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error('Использование: npx tsx scripts/resync-shift-summaries.ts "Тенант" ГГГГ-ММ-ДД');
  process.exit(1);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: tenantName }, select: { id: true } });
  if (!tenant) throw new Error(`Тенант «${tenantName}» не найден`);

  const settings = await prisma.shiftCloseSummarySettings.findUnique({ where: { tenantId: tenant.id } });
  const channel = await prisma.tenantSummaryChannel.findFirst({
    where: { tenantId: tenant.id, channelType: "telegram", pointId: null, enabled: true },
  });
  console.log(`Канал: ${channel ? `есть, ${channel.chatStatus}` : "НЕТ"}`);
  console.log(`Сводка закрытия смены включена: ${settings ? settings.enabled : "настроек нет (по умолчанию)"}`);
  console.log(`Компактный вид: ${settings?.compact ?? "—"}`);

  // Смены, ЗАКРЫТЫЕ в этот день: сообщение отправляется в момент закрытия,
  // поэтому ориентируемся на endAt, а не на начало.
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 48 * 60 * 60 * 1000);
  const shifts = await prisma.shift.findMany({
    where: { operator: { tenantId: tenant.id }, endAt: { gte: from, lt: to }, isOpen: false },
    include: { operator: { select: { id: true, name: true } } },
    orderBy: { endAt: "asc" },
  });

  console.log(`\nЗакрытых смен в окне: ${shifts.length}`);
  for (const sh of shifts) {
    const tag = sh.operator.name.padEnd(10);
    if (!sh.telegramSummaryMessageId) {
      console.log(`  ${tag} сообщения нет — пересобирать нечего`);
      continue;
    }
    const rate = await getRateForDate(sh.operator.id, sh.startAt);
    const { accrued } = calcShiftAccrual(sh.startAt, sh.endAt!, rate);
    const balance = await calcOperatorBalance(sh.operator.id);
    await resyncShiftCloseMessage(sh.id);
    console.log(
      `  ${tag} id ${sh.telegramSummaryMessageId}: ставка ${rate}, начислено ${accrued.toFixed(2)}, ` +
        `к выдаче ${balance.toPayOut.toFixed(2)} — пересобрано`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
