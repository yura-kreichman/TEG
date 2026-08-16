import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { previousSubmissionBoundary } from "@/lib/game-room";
import { isCountersZone } from "@/lib/results-calc";

/**
 * Журнал "Возврат/тест" (docs/spec/01-counters.md, п.3) — запрос
 * пользователя 2026-07-24: раньше это было одно число, вводимое Сотрудником
 * "из головы" на самом мастере сдачи итогов, теперь каждый факт фиксируется
 * сразу через пункт нижнего бара "Счётчики", а сдача итогов только суммирует
 * записи ЭТОГО эндпоинта за текущий период (см. submit-results/route.ts).
 *
 * "Текущий период" зоны — тот же принцип, что и у показаний счётчиков
 * (previousSubmissionBoundary): всё, что накопилось ПОСЛЕ последней сдачи
 * этой конкретной зоны, автоматически "обнуляется" следующей сдачей — без
 * отдельного поля-флага "учтено/не учтено" на самой записи.
 */
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id, active: true }
    : { pointId: point.id, active: true, operatorsWithAccess: { some: { id: operator.id } } };

  // countersTapAssistEnabled: false (запрос пользователя 2026-07-25) — у
  // tap-зон "Возврат/тест" теперь привязывается к КОНКРЕТНОМУ тапу
  // (CounterTapEvent.voidedAt, см. /api/operator/counter-tap-events), этот
  // зонный журнал для них больше не источник истины вовсе — без фильтра
  // Сотрудник мог бы создать запись, которая тихо не влияла бы на расчёт.
  const zones = await prisma.zone.findMany({
    where: { ...zoneWhere, accountingMode: "counters", countersTapAssistEnabled: false },
    select: { id: true, name: true, iconKey: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (zones.length === 0) {
    return NextResponse.json({ zones: [], events: [] });
  }

  const boundaries = await Promise.all(zones.map((z) => previousSubmissionBoundary(z.id)));
  const boundaryByZone = new Map(zones.map((z, i) => [z.id, boundaries[i]]));

  const rawEvents = await prisma.zoneReturnEvent.findMany({
    where: { zoneId: { in: zones.map((z) => z.id) } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // Только текущий (ещё не сданный) период каждой зоны — события до её
  // последней сдачи относятся к уже закрытому периоду, показывать их тут
  // незачем (та сдача уже зафиксировала своё число, эта запись больше не
  // "живая").
  const events = rawEvents.filter((e) => {
    const boundary = boundaryByZone.get(e.zoneId);
    return !boundary || e.createdAt > boundary;
  });

  const zoneById = new Map(zones.map((z) => [z.id, z]));
  return NextResponse.json({
    zones,
    events: events.map((e) => ({
      id: e.id,
      zoneId: e.zoneId,
      zoneName: zoneById.get(e.zoneId)?.name ?? "",
      createdAt: e.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;
  const body = await request.json().catch(() => null);
  const zoneId = body?.zoneId;
  if (typeof zoneId !== "string" || !zoneId) {
    return NextResponse.json({ error: "Не указана зона" }, { status: 400 });
  }

  const zone = await prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId: point.id,
      active: true,
      countersTapAssistEnabled: false,
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: { id: true, accountingMode: true },
  });
  if (!zone || !isCountersZone(zone)) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const event = await prisma.zoneReturnEvent.create({
    data: { zoneId: zone.id, pointId: point.id, operatorId: operator.id },
  });
  return NextResponse.json({ id: event.id, zoneId: event.zoneId, createdAt: event.createdAt });
}
