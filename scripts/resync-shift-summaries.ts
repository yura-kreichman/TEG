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
// Дефолт нужен, чтобы скрипт читал «включена ли сводка» тем же правилом, что и
// resyncShiftCloseMessage: настроек нет — значит включена.
import { SHIFT_CLOSE_SUMMARY_DEFAULTS } from "../src/lib/summary-settings";

const [tenantName, day] = process.argv.slice(2);
if (!tenantName || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error('Использование: npx tsx scripts/resync-shift-summaries.ts "Тенант" ГГГГ-ММ-ДД');
  process.exit(1);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: tenantName }, select: { id: true } });
  if (!tenant) throw new Error(`Тенант «${tenantName}» не найден`);

  const settings = await prisma.shiftCloseSummarySettings.findUnique({ where: { tenantId: tenant.id } });
  // Условия ДОСЛОВНО те же, что у resyncShiftCloseMessage (resync.ts:277-279):
  // она требует chatStatus: "active" и непустой chatId. Прежний запрос статус не
  // проверял, поэтому канал в pending/blocked печатался как «есть», функция
  // молча выходила, а скрипт всё равно рапортовал «пересобрано».
  const channel = await prisma.tenantSummaryChannel.findFirst({
    where: { tenantId: tenant.id, channelType: "telegram", pointId: null, enabled: true, chatStatus: "active" },
  });
  // Канал без фильтров — только чтобы напечатать, ПОЧЕМУ он не подошёл.
  const anyChannel = await prisma.tenantSummaryChannel.findFirst({
    where: { tenantId: tenant.id, channelType: "telegram", pointId: null },
    select: { enabled: true, chatStatus: true, chatId: true },
  });
  console.log(
    `Канал: ${
      channel?.chatId
        ? `есть, ${channel.chatStatus}`
        : anyChannel
          ? `НЕ ПОДХОДИТ (enabled=${anyChannel.enabled}, chatStatus=${anyChannel.chatStatus}, chatId=${anyChannel.chatId ?? "нет"})`
          : "НЕТ"
    }`
  );
  const summaryEnabled = settings ? settings.enabled : SHIFT_CLOSE_SUMMARY_DEFAULTS.enabled;
  console.log(`Сводка закрытия смены включена: ${summaryEnabled}${settings ? "" : " (настроек нет, по умолчанию)"}`);
  console.log(`Компактный вид: ${settings?.compact ?? SHIFT_CLOSE_SUMMARY_DEFAULTS.compact}`);

  // resyncShiftCloseMessage отдаёт void и по этим двум условиям выходит молча
  // (resync.ts:287 и :290). Пока они не выполнены, ни одно сообщение тронуто не
  // будет — причину надо назвать, иначе вывод выглядит успешным.
  const skipReason = !channel?.chatId
    ? "канал не активен"
    : !summaryEnabled
      ? "сводка закрытия смены выключена в настройках"
      : null;

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
    if (skipReason) {
      // «Пересобрано» означало лишь «функция вернулась»: возвращаемого значения у
      // resyncShiftCloseMessage нет. Раз условие пересборки не выполнено, вызывать
      // её бессмысленно — печатаем причину вместо ложного успеха.
      console.log(`  ${tag} id ${sh.telegramSummaryMessageId}: пропущено — ${skipReason}`);
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
