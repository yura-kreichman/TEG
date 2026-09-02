/**
 * Проверка правила «Разница у сотрудника и у владельца — одно и то же число»
 * (генеральная проверка финансов 2026-09-02, находка С4).
 *
 * Запуск: npx tsx scripts/check-submission-difference.ts
 *
 * Сдача итогов возвращает в выручку только КОМПЕНСИРУЕМЫЕ расходы — те, деньги
 * на которые ещё лежат в ящике. Расход, оплаченный деньгами, которые потом
 * уехали с инкассацией, к сдаче привязывается (resultsSubmissionId), но в её
 * выручку не входит. Все места чтения восстанавливали расходы по привязке и
 * потому показывали излишек ровно на такие траты: у сотрудника 0, у владельца
 * на «Итогах дня», в «Деньгах», на Главной и в правленной Telegram-сводке —
 * плюс 460 (пример из находки).
 *
 * Скрипт берёт боевые сдачи и сверяет Разницу, которую отдаёт библиотека
 * отчётов, с формулой самой сдачи (submit-results/route.ts): касса + записанная
 * компенсация + абонемент − расчётная. Расхождение здесь — это ровно тот баг,
 * вернувшийся обратно.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeZoneSubmissionRevenues } from "../src/lib/reports";

const ROLLBACK = "__rollback__";

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`  ${ok ? "ok   " : "ПЛОХО"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  const submissions = await prisma.zoneSubmission.findMany({
    select: {
      id: true,
      zoneId: true,
      cashAmount: true,
      mobileAmount: true,
      compensatedExpenses: true,
      collectedBeforeSubmission: true,
      resultsSubmissionId: true,
      resultsSubmission: { select: { submittedAt: true } },
      zone: { select: { name: true, accountingMode: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  if (submissions.length === 0) {
    console.log("Сдач в базе нет — сверять нечего. Это не «сошлось», а отсутствие данных.");
    return;
  }

  const stored = submissions.filter((z) => z.compensatedExpenses !== null);
  console.log(`Сдач в выборке: ${submissions.length}, из них с записанной компенсацией: ${stored.length}`);

  // Привязанные расходы — то более широкое множество, по которому считали
  // раньше. Там, где оно шире компенсируемого, сценарий находки реально
  // встречается, и проверка не холостая.
  const attached = await prisma.moneyOperation.groupBy({
    by: ["resultsSubmissionId", "zoneId"],
    where: {
      type: "expense",
      resultsSubmissionId: { in: [...new Set(submissions.map((z) => z.resultsSubmissionId))] },
    },
    _sum: { amount: true },
  });
  const attachedBy = new Map(
    attached.map((a) => [`${a.resultsSubmissionId}:${a.zoneId}`, Math.abs(Number(a._sum.amount ?? 0))])
  );

  let divergent = 0;
  for (const zs of stored) {
    const byLink = attachedBy.get(`${zs.resultsSubmissionId}:${zs.zoneId}`) ?? 0;
    if (Math.abs(Number(zs.compensatedExpenses) - byLink) > 0.005) divergent++;
  }
  console.log(
    `Сдач, где «компенсируемые» ≠ «привязанные»: ${divergent}` +
      (divergent === 0 ? "  (сценарий находки в выборке не встретился — проверка формулы всё равно идёт)" : "")
  );

  // Прогоняем ту же функцию, которой пользуются «Итоги дня», «Деньги» и
  // Отчёты, и сверяем её Разницу с формулой сдачи. Считаем по дням, чтобы
  // окно совпадало с тем, как отчёты её и вызывают.
  const byDay = new Map<string, { zoneIds: Set<string>; from: Date; to: Date }>();
  for (const zs of submissions) {
    const at = zs.resultsSubmission.submittedAt;
    const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - 1));
    const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 2));
    const key = at.toISOString().slice(0, 10);
    const slot = byDay.get(key) ?? { zoneIds: new Set<string>(), from, to };
    slot.zoneIds.add(zs.zoneId);
    byDay.set(key, slot);
  }

  const computed = new Map<string, { difference: number; calculatedRevenue: number; abonementAmount: number }>();
  for (const { zoneIds, from, to } of byDay.values()) {
    const rows = await computeZoneSubmissionRevenues([...zoneIds], from, to);
    for (const r of rows) {
      computed.set(r.zoneSubmissionId, {
        difference: r.difference,
        calculatedRevenue: r.calculatedRevenue,
        abonementAmount: r.abonementAmount,
      });
    }
  }

  let checked = 0;
  for (const zs of submissions) {
    const row = computed.get(zs.id);
    if (!row) continue;
    if (zs.zone.accountingMode === "cash_only") continue;
    checked++;

    const actual = Number(zs.cashAmount) + Number(zs.mobileAmount);
    const byLink = attachedBy.get(`${zs.resultsSubmissionId}:${zs.zoneId}`) ?? 0;
    const expenses = zs.compensatedExpenses !== null ? Number(zs.compensatedExpenses) : byLink;
    // Забранное владельцем до пересчёта — вторая половина поправки «мимо
    // ящика» (getZoneCollectionOverdraw). У сдач до 2026-09-02 его нет.
    const collectedBefore = Number(zs.collectedBeforeSubmission ?? 0);
    // Формула сдачи, слово в слово: submit-results/route.ts.
    const expected =
      Math.round((actual + expenses + collectedBefore + row.abonementAmount - row.calculatedRevenue) * 100) / 100;

    if (Math.abs(row.difference - expected) > 0.005) {
      check(
        false,
        `${zs.zone.name} · сдача ${zs.id.slice(0, 8)}: отчёт ${row.difference}, сдача ${expected}` +
          ` (компенсация ${expenses}, привязано ${byLink})`
      );
    }
  }

  console.log(`Сверено сдач через computeZoneSubmissionRevenues: ${checked}`);

  await liveScenario(submissions, attachedBy);
  await overdrawScenario();

  if (failures === 0) console.log("\nВСЁ СОШЛОСЬ");
  else console.log(`\nРАСХОЖДЕНИЙ: ${failures}`);
}

/**
 * Пока ни одной сдачи с записанной компенсацией нет, всё выше проверяет только
 * что старые строки не сломались. Сам сценарий находки — «компенсация 0, а
 * расходы к сдаче привязаны» — надо создать руками, иначе «сошлось» ничего не
 * значит (тот же урок, что и в check-change-fund-in-till.ts).
 *
 * Пишем поле, проверяем, возвращаем обратно в NULL. Через $transaction нельзя:
 * computeZoneSubmissionRevenues ходит в глобальный prisma и внутри незакрытой
 * транзакции изменений не увидит. Поэтому — только на локальной базе.
 */
async function liveScenario(
  submissions: { id: string; zoneId: string; resultsSubmissionId: string; zone: { name: string } }[],
  attachedBy: Map<string, number>
) {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.log("\nСценарий пропущен: база не локальная, писать в неё нельзя.");
    return;
  }

  const victim = submissions.find((zs) => (attachedBy.get(`${zs.resultsSubmissionId}:${zs.zoneId}`) ?? 0) > 0);
  if (!victim) {
    console.log("\nСценарий пропущен: в выборке нет сдачи с привязанными расходами.");
    return;
  }

  const attachedAmount = attachedBy.get(`${victim.resultsSubmissionId}:${victim.zoneId}`)!;
  const at = (await prisma.resultsSubmission.findUniqueOrThrow({
    where: { id: victim.resultsSubmissionId },
    select: { submittedAt: true },
  })).submittedAt;
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - 1));
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 2));

  const diffOf = async () => {
    const rows = await computeZoneSubmissionRevenues([victim.zoneId], from, to);
    return rows.find((r) => r.zoneSubmissionId === victim.id)?.difference;
  };

  console.log(`\n=== сценарий с восстановлением: ${victim.zone.name}, привязано расходов ${attachedAmount}`);
  const before = await diffOf();
  try {
    await prisma.zoneSubmission.update({ where: { id: victim.id }, data: { compensatedExpenses: 0 } });
    const withZero = await diffOf();
    check(
      before !== undefined && withZero !== undefined && Math.abs(before - withZero - attachedAmount) < 0.005,
      `компенсация 0 убирает из Разницы ровно привязанные расходы: ${before} → ${withZero}`
    );

    await prisma.zoneSubmission.update({
      where: { id: victim.id },
      data: { compensatedExpenses: attachedAmount },
    });
    const withFull = await diffOf();
    check(
      before !== undefined && withFull !== undefined && Math.abs(before - withFull) < 0.005,
      `компенсация = привязанным даёт прежнее число: ${withFull}`
    );
  } finally {
    await prisma.zoneSubmission.update({ where: { id: victim.id }, data: { compensatedExpenses: null } });
  }
  const restored = await diffOf();
  check(before !== undefined && restored !== undefined && Math.abs(before - restored) < 0.005, "поле возвращено в NULL");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Случай КидсБурга 2026-09-02: владелец забрал кассу среди дня, до пересчёта.
 *
 *   16:26  инкассация −305    остаток   0     ← вчерашнее, в поправку не идёт
 *   18:17  инкассация −2000   остаток −2000   ← сегодняшняя выручка
 *   20:02  сдача       +70    остаток −1930
 *
 * Счётчики намотали на 3675, касса показала 2135 — «недостача» 1540 из
 * воздуха. Проверяем, что getZoneCollectionOverdraw возвращает ровно 2000:
 * не 2305 (тогда в поправку попадёт вчерашнее) и не 1930 (тогда завтрашняя
 * сдача унаследует сегодняшний долг).
 */
async function overdrawScenario() {
  const { getZoneCollectionOverdraw } = await import("../src/lib/zone-balance");
  const zone = await prisma.zone.findFirst({
    where: { accountingMode: "counters" },
    select: { id: true, name: true, pointId: true, point: { select: { tenantId: true } } },
  });
  if (!zone) {
    console.log("\nСценарий пропущен: counters-зоны в базе нет.");
    return;
  }

  console.log(`\n=== сценарий с откатом: ${zone.name}`);
  const t0 = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60 * 1000);

  await prisma
    .$transaction(async (tx) => {
      const tenantId = zone.point.tenantId;
      const add = (type: string, amount: number, occurredAt: Date) =>
        tx.moneyOperation.create({ data: { tenantId, zoneId: zone.id, type, amount, occurredAt } });

      // Обнуляем то, что уже лежит в зоне, чтобы считать с чистого листа.
      const opening = await getZoneCollectionOverdraw([zone.id], new Map([[zone.id, null]]), at(0), tx);
      const openingDeficit = opening.get(zone.id) ?? 0;

      // Вчерашняя сдача оставила в кассе 305.
      await add("revenue", 305, at(1));
      const boundary = at(2); // граница прошлой сдачи
      const since = new Map([[zone.id, boundary]]);

      await add("collection", -305, at(3));
      const afterOld = await getZoneCollectionOverdraw([zone.id], since, at(4), tx);
      check(
        Math.abs((afterOld.get(zone.id) ?? 0) - openingDeficit) < 0.001,
        `инкассация вчерашних денег в поправку не идёт: ${afterOld.get(zone.id) ?? 0}`
      );

      await add("collection", -2000, at(5));
      const afterToday = await getZoneCollectionOverdraw([zone.id], since, at(6), tx);
      check(
        Math.abs((afterToday.get(zone.id) ?? 0) - openingDeficit - 2000) < 0.001,
        `забранное сверх остатка учтено: ${afterToday.get(zone.id) ?? 0}`
      );

      // Сдача: сотрудник ввёл 70, сервер прибавляет поправку — остаток
      // возвращается к тому, что физически в ящике.
      await add("revenue", 70 + 2000, at(7));
      const nextBoundary = at(8);
      const nextSince = new Map([[zone.id, nextBoundary]]);
      const tomorrow = await getZoneCollectionOverdraw([zone.id], nextSince, at(9), tx);
      check(
        Math.abs(tomorrow.get(zone.id) ?? 0) < 0.001,
        `завтрашняя сдача не наследует сегодняшнюю поправку: ${tomorrow.get(zone.id) ?? 0}`
      );

      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (err instanceof Error && err.message === ROLLBACK) {
        console.log("  транзакция откачена");
        return;
      }
      throw err;
    });
}
