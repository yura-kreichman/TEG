import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";

// Правка суммы отдельного (не привязанного к смене) аванса/премии —
// docs/spec/05-work-time.md, "АВАНС"/"ПРЕМИЯ": "владелец может редактировать".
// Журнал правок как в Счётчиках: было → стало.
export async function PATCH(request: Request, ctx: RouteContext<"/api/work-time/money-ops/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  if (!op || op.tenantId !== owner.tenantId || (op.type !== "advance" && op.type !== "bonus_payout")) {
    return NextResponse.json({ error: "Операция не найдена" }, { status: 404 });
  }

  const { amount, reason } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const before = Math.abs(Number(op.amount));

  if (op.type === "advance" && amountNumber > before && op.beneficiaryOperatorId) {
    const beneficiary = await prisma.operator.findUnique({
      where: { id: op.beneficiaryOperatorId },
      select: { overdraftAllowed: true },
    });
    const balance = await calcOperatorBalance(op.beneficiaryOperatorId);
    const availableExcludingThis = balance.toPayOut + before;
    if (!beneficiary?.overdraftAllowed && amountNumber > availableExcludingThis) {
      return NextResponse.json(
        { error: `Аванс превышает доступный баланс к выдаче (${availableExcludingThis.toFixed(2)})` },
        { status: 400 }
      );
    }
  }

  if (before !== amountNumber) {
    await prisma.$transaction([
      prisma.moneyOperation.update({ where: { id }, data: { amount: -amountNumber } }),
      prisma.correctionLog.create({
        data: {
          entityType: "MoneyOperation",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: { amount: before },
          afterJson: { amount: amountNumber },
          comment: typeof reason === "string" && reason.trim() ? reason.trim() : null,
        },
      }),
    ]);
  }

  return NextResponse.json({
    balance: op.beneficiaryOperatorId ? await calcOperatorBalance(op.beneficiaryOperatorId) : null,
  });
}

// Удаление отдельного (не привязанного к смене) аванса/премии — владелец
// вводит их вручную из карточки, значит должен уметь и убрать ошибочную
// запись целиком, не только поправить сумму.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/work-time/money-ops/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  if (!op || op.tenantId !== owner.tenantId || (op.type !== "advance" && op.type !== "bonus_payout")) {
    return NextResponse.json({ error: "Операция не найдена" }, { status: 404 });
  }

  const before = { type: op.type, amount: Math.abs(Number(op.amount)) };
  const beneficiaryOperatorId = op.beneficiaryOperatorId;

  await prisma.$transaction([
    prisma.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: { deleted: true },
        comment: null,
      },
    }),
    prisma.moneyOperation.delete({ where: { id } }),
  ]);

  return NextResponse.json({
    balance: beneficiaryOperatorId ? await calcOperatorBalance(beneficiaryOperatorId) : null,
  });
}
