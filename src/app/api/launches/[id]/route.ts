import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { computeLaunchAmount, type LaunchPricingMode, type LaunchRoundingMode } from "@/lib/game-room";

// Правка времени пуска — только владелец, с журналом (docs/spec/04-game-room.md,
// "Жизненный цикл") — тот же паттерн, что у показаний/инкассаций: было → стало
// в CorrectionLog, а не отдельными полями на Launch.
export async function PATCH(request: Request, ctx: RouteContext<"/api/launches/[id]">) {
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

  const body = await request.json();
  const startedAt = body.startedAt ? new Date(body.startedAt) : launch.startedAt;
  const endedAt = body.endedAt !== undefined ? (body.endedAt ? new Date(body.endedAt) : null) : launch.endedAt;

  if (Number.isNaN(startedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) {
    return NextResponse.json({ error: "Некорректное время" }, { status: 400 });
  }
  if (endedAt && endedAt < startedAt) {
    return NextResponse.json({ error: "Окончание раньше начала" }, { status: 400 });
  }

  const amount = endedAt
    ? computeLaunchAmount(
        {
          pricingMode: launch.pricingMode as LaunchPricingMode,
          priceSnapshot: launch.priceSnapshot,
          durationMinutesSnapshot: launch.durationMinutesSnapshot,
          roundingModeSnapshot: launch.roundingModeSnapshot as LaunchRoundingMode | null,
          minAmountSnapshot: launch.minAmountSnapshot,
        },
        startedAt,
        endedAt
      )
    : null;

  const before = {
    startedAt: launch.startedAt,
    endedAt: launch.endedAt,
    amount: launch.amount != null ? Number(launch.amount) : null,
  };
  const after = { startedAt, endedAt, amount };

  await prisma.$transaction([
    prisma.launch.update({
      where: { id },
      data: { startedAt, endedAt, isOpen: endedAt === null, amount },
    }),
    prisma.correctionLog.create({
      data: {
        entityType: "Launch",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: after,
        comment: typeof body.comment === "string" ? body.comment : null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
