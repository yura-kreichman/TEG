import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/modules";
import { calcOperatorBalance, calcShiftAccrual, getRateForDate, hasOverlappingShift, validateShift } from "@/lib/work-time";

interface ShiftCorrectionDiff {
  startAt: string;
  endAt: string;
  advanceAmount: number;
  bonusAmount: number;
}

async function loadShift(id: string, tenantId: string) {
  const shift = await prisma.shift.findUnique({ where: { id } });
  if (!shift || shift.tenantId !== tenantId) return null;
  return shift;
}

async function loadLinkedMoneyOps(shiftId: string) {
  return prisma.moneyOperation.findMany({
    where: { shiftId, type: { in: ["advance", "bonus_payout"] } },
  });
}

// Правка смены — только владелец: время, премия, аванс
// (docs/spec/05-work-time.md, "ИНТЕРФЕЙС ВЛАДЕЛЬЦА"). Журнал правок как в
// Счётчиках: было → стало, необязательная причина.
export async function PATCH(request: Request, ctx: RouteContext<"/api/work-time/shifts/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "work_time"))) {
    return NextResponse.json({ error: "Модуль не подключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const shift = await loadShift(id, owner.tenantId);
  if (!shift) {
    return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
  }

  const linkedOps = await loadLinkedMoneyOps(id);
  const currentAdvance = linkedOps.filter((o) => o.type === "advance").reduce((s, o) => s + Math.abs(Number(o.amount)), 0);
  const currentBonus = linkedOps.filter((o) => o.type === "bonus_payout").reduce((s, o) => s + Math.abs(Number(o.amount)), 0);

  const body = await request.json();
  const { startAt: startAtInput, endAt: endAtInput, advanceAmount: advanceInput, bonusAmount: bonusInput, reason } =
    body as {
      startAt?: string;
      endAt?: string;
      advanceAmount?: number;
      bonusAmount?: number;
      reason?: string;
    };

  const nextStartAt = startAtInput !== undefined ? new Date(startAtInput) : shift.startAt;
  const nextEndAt = endAtInput !== undefined ? new Date(endAtInput) : shift.endAt;
  if (Number.isNaN(nextStartAt.getTime()) || Number.isNaN(nextEndAt.getTime()) || nextEndAt <= nextStartAt) {
    return NextResponse.json({ error: "Некорректное время смены" }, { status: 400 });
  }

  if (await hasOverlappingShift(shift.operatorId, nextStartAt, nextEndAt, shift.id)) {
    return NextResponse.json({ error: "Смена пересекается с другой сменой этого оператора" }, { status: 409 });
  }

  const nextAdvance = advanceInput !== undefined ? Math.abs(Number(advanceInput)) : currentAdvance;
  const nextBonus = bonusInput !== undefined ? Math.abs(Number(bonusInput)) : currentBonus;
  if (!Number.isFinite(nextAdvance) || !Number.isFinite(nextBonus) || nextAdvance < 0 || nextBonus < 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  if (nextAdvance > currentAdvance) {
    const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { overdraftAllowed: true } });
    // Баланс без учёта уже выданного по этой же смене аванса — иначе он бы
    // дважды вычитался (уже сидит в текущем toPayOut).
    const balance = await calcOperatorBalance(shift.operatorId);
    const availableExcludingThisShift = balance.toPayOut + currentAdvance;
    if (!tenant?.overdraftAllowed && nextAdvance > availableExcludingThisShift) {
      return NextResponse.json(
        { error: `Аванс превышает доступный баланс к выдаче (${availableExcludingThisShift.toFixed(2)})` },
        { status: 400 }
      );
    }
  }

  const warnings = validateShift(nextStartAt, nextEndAt);

  const before: ShiftCorrectionDiff = {
    startAt: shift.startAt.toISOString(),
    endAt: shift.endAt.toISOString(),
    advanceAmount: currentAdvance,
    bonusAmount: currentBonus,
  };
  const after: ShiftCorrectionDiff = {
    startAt: nextStartAt.toISOString(),
    endAt: nextEndAt.toISOString(),
    advanceAmount: nextAdvance,
    bonusAmount: nextBonus,
  };
  const changed = JSON.stringify(before) !== JSON.stringify(after);

  const tenantId = owner.tenantId;
  const correctedByUserId = owner.user.id;
  const shiftId = shift.id;
  const shiftPointId = shift.pointId;
  const shiftOperatorId = shift.operatorId;

  await prisma.$transaction(async (tx) => {
    await tx.shift.update({ where: { id }, data: { startAt: nextStartAt, endAt: nextEndAt } });

    const syncLinkedOp = async (type: "advance" | "bonus_payout", amount: number) => {
      const existing = linkedOps.find((o) => o.type === type);
      if (amount > 0) {
        if (existing) {
          await tx.moneyOperation.update({ where: { id: existing.id }, data: { amount: -amount } });
        } else {
          await tx.moneyOperation.create({
            data: {
              tenantId,
              pointId: shiftPointId,
              type,
              amount: -amount,
              performedByUserId: correctedByUserId,
              beneficiaryOperatorId: shiftOperatorId,
              shiftId,
            },
          });
        }
      } else if (existing) {
        await tx.moneyOperation.delete({ where: { id: existing.id } });
      }
    };

    await syncLinkedOp("advance", nextAdvance);
    await syncLinkedOp("bonus_payout", nextBonus);

    if (changed) {
      await tx.correctionLog.create({
        data: {
          entityType: "Shift",
          entityId: id,
          correctedByUserId,
          beforeJson: JSON.parse(JSON.stringify(before)),
          afterJson: JSON.parse(JSON.stringify(after)),
          comment: typeof reason === "string" && reason.trim() ? reason.trim() : null,
        },
      });
    }
  });

  const rate = await getRateForDate(shift.operatorId, nextStartAt);
  const { minutes, accrued } = calcShiftAccrual(nextStartAt, nextEndAt, rate);

  return NextResponse.json({
    shift: { id, startAt: nextStartAt, endAt: nextEndAt, minutes, rate, accrued, advanceAmount: nextAdvance, bonusAmount: nextBonus },
    warnings,
  });
}

// Удаление смены — только последняя (по startAt) смена этого оператора,
// тот же принцип, что у последней сдачи итогов в Счётчиках: более ранние
// записи остаются доступны только для правки, не для удаления, чтобы не
// переписывать историю задним числом. Связанные аванс/премия удаляются
// вместе со сменой, чтобы не оставлять денежный след без записи.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/work-time/shifts/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "work_time"))) {
    return NextResponse.json({ error: "Модуль не подключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const shift = await loadShift(id, owner.tenantId);
  if (!shift) {
    return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
  }

  const laterShift = await prisma.shift.findFirst({
    where: { operatorId: shift.operatorId, id: { not: shift.id }, startAt: { gt: shift.startAt } },
    select: { id: true },
  });
  if (laterShift) {
    return NextResponse.json(
      { error: "Есть более поздняя смена этого оператора — сначала удалите её." },
      { status: 409 }
    );
  }

  const linkedOps = await loadLinkedMoneyOps(id);
  const before = {
    startAt: shift.startAt.toISOString(),
    endAt: shift.endAt.toISOString(),
    advanceAmount: linkedOps.filter((o) => o.type === "advance").reduce((s, o) => s + Math.abs(Number(o.amount)), 0),
    bonusAmount: linkedOps.filter((o) => o.type === "bonus_payout").reduce((s, o) => s + Math.abs(Number(o.amount)), 0),
  };

  await prisma.$transaction(async (tx) => {
    await tx.moneyOperation.deleteMany({ where: { shiftId: id, type: { in: ["advance", "bonus_payout"] } } });
    await tx.correctionLog.create({
      data: {
        entityType: "Shift",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: { deleted: true },
        comment: null,
      },
    });
    await tx.shift.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
