import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isLaunchesZone, isStaysZone, isTicketsZone } from "@/lib/results-calc";
import { aggregateGameRoomLaunches, aggregateOpenPrepaidLaunches, previousSubmissionBoundary } from "@/lib/game-room";
import { aggregateTicketOrders } from "@/lib/tickets";
import { round2 } from "@/lib/reports";

// "Расчётная выручка" на Главной (запрос пользователя 2026-07-25) — только
// режимы "Пуски"/"Прибывания"/"Билеты" знают выручку в реальном времени, ДО
// сдачи итогов (Launch/TicketOrder пишутся в момент самого пуска/продажи,
// не только при сдаче) — у "Счётчиков"/"Только кассы" такого сигнала нет
// вообще, расчёт возможен только после снятия показаний. "С момента
// последней сдачи по сейчас" — те же aggregateGameRoomLaunches/
// aggregateTicketOrders + previousSubmissionBoundary, что уже считает
// мастер сдачи итогов (submit-results/route.ts) для предпросмотра расчётной
// выручки — не отдельная логика, тот же источник истины.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pointIdParam = searchParams.get("pointId");

  const zones = await prisma.zone.findMany({
    where: { point: { tenantId: owner.tenantId }, active: true },
    select: {
      id: true,
      name: true,
      iconKey: true,
      accountingMode: true,
      pointId: true,
      point: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const liveZones = zones.filter((z) => isLaunchesZone(z) || isStaysZone(z) || isTicketsZone(z));

  // Точки, у которых есть хотя бы одна "живая" зона — для дропдауна на
  // Главной (запрос пользователя 2026-07-25: "Dropdown, если есть такая
  // точка, в которой есть такие Зоны") — точки без единой такой зоны в
  // список не попадают вовсе, карточка не должна предлагать выбрать точку,
  // где нечего будет показать.
  const seenPointIds = new Set<string>();
  const points: { id: string; name: string }[] = [];
  for (const z of liveZones) {
    if (seenPointIds.has(z.pointId)) continue;
    seenPointIds.add(z.pointId);
    points.push({ id: z.point.id, name: z.point.name });
  }
  points.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  if (points.length === 0) {
    return NextResponse.json({ points: [], total: 0, cash: 0, mobile: 0, zones: [] });
  }

  const isAllPoints = !pointIdParam || pointIdParam === "all";
  const scopedZones = isAllPoints ? liveZones : liveZones.filter((z) => z.pointId === pointIdParam);

  const now = new Date();
  const perZone = await Promise.all(
    scopedZones.map(async (zone) => {
      const since = await previousSubmissionBoundary(zone.id);
      if (isTicketsZone(zone)) {
        return { zone, agg: await aggregateTicketOrders(zone.id, since, now) };
      }
      // Идущие браслеты "За вход" — деньги за них уже в кассе (оплата берётся
      // при старте), поэтому в живую карточку они входят наравне с закрытыми
      // (запрос пользователя 2026-08-23). Только здесь, не в сдаче итогов —
      // см. aggregateOpenPrepaidLaunches в lib/game-room.ts.
      const [closed, openPrepaid] = await Promise.all([
        aggregateGameRoomLaunches(zone.id, since, now),
        aggregateOpenPrepaidLaunches(zone.id, since, now),
      ]);
      return {
        zone,
        agg: {
          ...closed,
          totalAmount: round2(closed.totalAmount + openPrepaid.totalAmount),
          cashAmount: round2(closed.cashAmount + openPrepaid.cashAmount),
          mobileAmount: round2(closed.mobileAmount + openPrepaid.mobileAmount),
          abonementAmount: round2(closed.abonementAmount + openPrepaid.abonementAmount),
        },
      };
    })
  );

  let total = 0;
  let cash = 0;
  let mobile = 0;
  const zoneRows = perZone
    .map(({ zone, agg }) => {
      // Баланс (пуск/билет, оплаченный СО баланса) намеренно исключён из
      // выручки целиком — та же логика, что уже применена в Деньгах/Отчётах
      // (2026-07-25): деньги уже учтены как выручка в момент ПОПОЛНЕНИЯ
      // баланса клиентом, повторный учёт при трате был бы двойным счётом
      // (реальный баг, найден пользователем на этой же карточке). Не просто
      // "cash + mobile" — так тоже потерялась бы часть настоящей выручки:
      // totalAmount может быть больше cash+mobile+abonement у старых пусков
      // "За вход" без способа оплаты (до 2026-07-17 он у них не спрашивался,
      // см. GameRoomAggregate/TicketOrderAggregate — там то же самое).
      const zoneTotal = agg.totalAmount - agg.abonementAmount;
      total += zoneTotal;
      cash += agg.cashAmount;
      mobile += agg.mobileAmount;
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        // Имя точки — только если "живых" точек реально больше одной (баг,
        // найден пользователем 2026-07-25: раньше зависело от того, передан
        // ли pointId в запросе, а не от того, есть ли вообще неоднозначность
        // — при ЕДИНСТВЕННОЙ живой точке имя показывалось всегда без всякой
        // причины). points — это ВСЕ "живые" точки тенанта, не текущая
        // выборка zoneRows.
        pointName: points.length > 1 ? zone.point.name : null,
        iconKey: zone.iconKey,
        total: round2(zoneTotal),
      };
    })
    // Нулевая выручка — не показываем строку вовсе (запрос пользователя
    // 2026-07-25, аудит: "нули нам не нужны") — зона без единого
    // завершённого пуска/билета с прошлой сдачи не несёт информации.
    .filter((z) => z.total > 0)
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    points,
    total: round2(total),
    cash: round2(cash),
    mobile: round2(mobile),
    zones: zoneRows,
  });
}
