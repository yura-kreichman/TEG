import { prisma } from "@/lib/prisma";

/**
 * Что владельцу разрешено делать с уже сданной зоной-сдачей. Три разных
 * права, а не одно: цена ошибки у них разная.
 *
 * `canEditReadings` — правка показаний счётчиков. Опасна вне последнего
 * звена цепочки: показание это база, от которой СЛЕДУЮЩАЯ сдача посчитала
 * свои сеансы, и сдвиг задним числом молча переписал бы её выручку
 * (docs/spec/01-counters.md, «Прозрачность»). Цепочка на AssetReading есть
 * только у "counters".
 *
 * `canDelete` — удаление всей записи. У "stays"/"launches"(тап)/"tickets"
 * своя, недокументированная цепочка: окно агрегации следующей сдачи той же
 * зоны считается от самой поздней СУЩЕСТВУЮЩЕЙ строки ZoneSubmission
 * (previousSubmissionBoundary в game-room.ts, ticketBoundariesByZone в
 * reports/submissions/day/route.ts), а не по FK на конкретную запись. Аудит
 * 2026-07-24 нашёл, что удаление такой сдачи расширяет окно назад и
 * задваивает уже собранную выручку пусков/билетов — поэтому им нельзя.
 *
 * `canEditCash` — правка наличных и безнала. Не задевает НИ ОДНУ из этих
 * цепочек: в "stays"/"launches"/"tickets" касса вообще не участвует в
 * расчёте выручки, это «сколько реально в ящике» против того, что насчитала
 * система. Аудит 2026-07-24 закрыл её заодно с удалением, скопом — и это
 * оставило владельца без всякого выхода, когда сотрудник ошибся с суммой:
 * реальный случай 2026-08-26 (Керен Центр, зона «Халабуда» — сотрудник сдал
 * итоги с нулевой кассой, поправить было нечем). Правка кассы разрешена
 * везде, где сдача существует; для "counters" — по тому же правилу
 * последнего звена, что и показания, потому что там правится одна форма
 * целиком.
 *
 * Спека (01-counters.md, «Прозрачность») говорит, что в "stays"/"launches"/
 * "cash_only"/"tickets" «любая сдача редактируется/удаляется» — в части
 * удаления это расхождение с кодом СОЗНАТЕЛЬНОЕ (см. аудит выше), спека
 * приведена к коду отдельной правкой того же дня.
 *
 * `accountingMode` можно передать, если вызывающий его уже знает — иначе
 * будет лишний запрос.
 */
export interface ZoneSubmissionEditability {
  canEditCash: boolean;
  canEditReadings: boolean;
  canDelete: boolean;
}

export async function getZoneSubmissionEditability(
  zoneSubmissionId: string,
  accountingMode?: string
): Promise<ZoneSubmissionEditability> {
  let mode = accountingMode;
  if (mode === undefined) {
    const zoneSubmission = await prisma.zoneSubmission.findUnique({
      where: { id: zoneSubmissionId },
      select: { zone: { select: { accountingMode: true } } },
    });
    mode = zoneSubmission?.zone.accountingMode;
  }

  // Никакой цепочки нет вовсе — правится и удаляется свободно.
  if (mode === "cash_only") return { canEditCash: true, canEditReadings: true, canDelete: true };

  // Живые зоны: касса правится, показаний нет, удаление задваивает выручку.
  if (mode !== "counters") return { canEditCash: true, canEditReadings: false, canDelete: false };

  const readings = await prisma.assetReading.findMany({
    where: { zoneSubmissionId },
    select: { assetId: true, tariffId: true, createdAt: true },
  });
  if (readings.length === 0) return { canEditCash: true, canEditReadings: true, canDelete: true };

  // One query for all touched asset+tariff pairs instead of one count per
  // reading — the (assetId, tariffId, createdAt) index makes each OR branch
  // an index lookup, so this stays a single round-trip regardless of how many
  // assets/tariffs the zone-submission covers.
  const laterReading = await prisma.assetReading.findFirst({
    where: {
      OR: readings.map((r) => ({
        assetId: r.assetId,
        tariffId: r.tariffId,
        createdAt: { gt: r.createdAt },
      })),
    },
    select: { id: true },
  });

  const isLastLink = laterReading === null;
  return { canEditCash: isLastLink, canEditReadings: isLastLink, canDelete: isLastLink };
}
