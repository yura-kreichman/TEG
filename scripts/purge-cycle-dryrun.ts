/**
 * Ручная проверка цикла автоудаления брошенных Free-кабинетов на локальной базе
 * (src/lib/tenant-lifecycle.ts). Не тест — сценарий: заводит тенанта с
 * подставленной датой регистрации, прогоняет цикл и печатает, что он сделал.
 *
 * Адрес владельца намеренно на example.com: цикл после удаления зовёт
 * маркетинговый сайт, и такого адреса там заведомо нет — сайт ответит
 * "absent", ничего не удалив.
 *
 * Запуск: npx tsx scripts/purge-cycle-dryrun.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { PURGE_AFTER_DAYS, FIRST_NOTICE_DAYS_BEFORE, FINAL_NOTICE_DAYS_BEFORE, runTenantPurgeCycle } from "../src/lib/tenant-lifecycle";

const DAY_MS = 86_400_000;
const EMAIL = "purge-probe@example.com";

async function makeTenant(ageDays: number) {
  const pkg = await prisma.package.findFirst({ where: { fluentcartProductId: null } });
  if (!pkg) throw new Error("нет Free-пакета в базе");

  const createdAt = new Date(Date.now() - ageDays * DAY_MS);
  const tenant = await prisma.tenant.create({
    data: { name: "Purge probe", packageId: pkg.id, createdAt, subscriptionStatus: "expired" },
  });
  await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: "probe",
      role: "owner",
      tenantId: tenant.id,
      createdAt,
    },
  });
  return tenant;
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { tenantId: true } });
  if (user?.tenantId) await prisma.tenant.delete({ where: { id: user.tenantId } }).catch(() => {});
}

async function main() {
  await cleanup();

  for (const ageDays of [
    PURGE_AFTER_DAYS - FIRST_NOTICE_DAYS_BEFORE - 1, // ещё рано
    PURGE_AFTER_DAYS - FIRST_NOTICE_DAYS_BEFORE + 1, // первое письмо
    PURGE_AFTER_DAYS - FINAL_NOTICE_DAYS_BEFORE + 1, // финальное письмо
    PURGE_AFTER_DAYS + 1, // удаление
  ]) {
    const tenant = await makeTenant(ageDays);
    const result = await runTenantPurgeCycle();
    const after = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { deletionNoticeSentAt: true, deletionFinalNoticeSentAt: true },
    });

    console.log(
      `возраст ${String(ageDays).padStart(3)} дн → warned=${result.warned} deleted=${result.deleted} ` +
        `| существует=${after !== null} первое=${Boolean(after?.deletionNoticeSentAt)} финальное=${Boolean(after?.deletionFinalNoticeSentAt)}`
    );

    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
