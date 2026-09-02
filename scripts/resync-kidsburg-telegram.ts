/**
 * Пересборка сообщений в Telegram по сдаче КидсБурга за 2 сентября 2026 —
 * с ПОДРОБНЫМ отчётом, без глушения ошибок.
 *
 * Запуск: npx tsx scripts/resync-kidsburg-telegram.ts
 *
 * Штатный resyncZoneSummaryMessage молча выходит в пяти местах: нет id
 * сообщения, канал не активен, сводка выключена в настройках, чат отвязан,
 * Telegram отказал в правке. Разовая починка вызывала его через .catch(() =>
 * {}), поэтому «пересобрано» в её выводе означало лишь «функция не бросила».
 * Здесь каждое условие проверяется явно и печатается.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resyncZoneSummaryMessage } from "../src/lib/summary-channels/zone-summary-message";
import { resyncDailyCashForPoint } from "../src/lib/summary-channels/resync";

const TENANT = "КидсБург";
const DAY_FROM = new Date("2026-09-02T00:00:00Z");

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: TENANT }, select: { id: true, name: true } });
  if (!tenant) throw new Error(`Тенант «${TENANT}» не найден`);

  // Почему сводка может не переписаться — проверяем ДО вызова, чтобы не
  // гадать по молчанию.
  const [channel, settings] = await Promise.all([
    prisma.tenantSummaryChannel.findFirst({
      where: { tenantId: tenant.id, channelType: "telegram", pointId: null, enabled: true },
    }),
    prisma.zoneSummarySettings.findUnique({ where: { tenantId: tenant.id } }),
  ]);
  console.log(`Канал Telegram: ${channel ? `есть, chatStatus=${channel.chatStatus}, chatId=${channel.chatId}` : "НЕТ"}`);
  console.log(`Сводка по зоне включена: ${settings ? settings.enabled : "настроек нет (значит по умолчанию)"}`);

  const submission = await prisma.resultsSubmission.findFirst({
    where: { tenantId: tenant.id, submittedAt: { gte: DAY_FROM } },
    orderBy: { submittedAt: "desc" },
    select: { id: true, pointId: true, submittedAt: true },
  });
  if (!submission) throw new Error("Сдача за 2 сентября не найдена");

  const zoneSubmissions = await prisma.zoneSubmission.findMany({
    where: { resultsSubmissionId: submission.id },
    select: {
      id: true,
      telegramSummaryMessageId: true,
      collectedBeforeSubmission: true,
      zone: { select: { name: true } },
    },
  });

  for (const zs of zoneSubmissions) {
    const tag = `${zs.zone.name.padEnd(12)}`;
    if (!zs.telegramSummaryMessageId) {
      console.log(`  ${tag} сообщения нет — пересобирать нечего`);
      continue;
    }
    try {
      await resyncZoneSummaryMessage(zs.id, tenant.id, { editedByOwner: true });
      console.log(
        `  ${tag} сообщение ${zs.telegramSummaryMessageId} переписано (поправка ${zs.collectedBeforeSubmission ?? 0})`
      );
    } catch (e) {
      console.log(`  ${tag} ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // «Касса за день» точки — отдельное сообщение, своя настройка.
  try {
    await resyncDailyCashForPoint(submission.pointId, tenant.id, submission.submittedAt);
    console.log("  «Касса за день» — пересобрана");
  } catch (e) {
    console.log(`  «Касса за день» ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
