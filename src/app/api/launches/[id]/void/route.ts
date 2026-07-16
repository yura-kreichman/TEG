import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Аннулирование пуска — только владелец, исключает его из расчётной выручки
// целиком (docs/spec/04-game-room.md, "Деньги и сдача итогов" — заменяет
// собой "возвраты/тестовые", которого у game_room-зон в мастере нет).
export async function POST(request: Request, ctx: RouteContext<"/api/launches/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const launch = await prisma.launch.findUnique({
    where: { id },
    include: { zone: { include: { point: true } } },
  });
  if (!launch || launch.zone.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Пуск не найден" }, { status: 404 });
  }
  if (launch.voidedAt) {
    return NextResponse.json({ error: "Пуск уже аннулирован" }, { status: 400 });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.launch.update({ where: { id }, data: { voidedAt: now } }),
    prisma.correctionLog.create({
      data: {
        entityType: "Launch",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: { voidedAt: null },
        afterJson: { voidedAt: now },
        comment: null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
