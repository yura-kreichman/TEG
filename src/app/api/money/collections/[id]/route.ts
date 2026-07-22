import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Правка/удаление ошибочно введённой инкассации — владелец или сотрудник
// иногда вносят её по ошибке или с опечаткой в сумме, только владелец может
// исправить. Журнал правок как у авансов/премий (/api/work-time/money-ops/[id]) —
// было → стало. Три типа (запрос пользователя 2026-07-22): type=collection
// (касса зоны) и collection_pool_sweep_abonement/_goods (абонементы/товары
// наличными точки, свои независимые кассы — lib/zone-balance.ts) — та же
// операция редактирования подходит всем, знак/формат суммы одинаковый.
export async function PATCH(request: Request, ctx: RouteContext<"/api/money/collections/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  if (
    !op ||
    op.tenantId !== owner.tenantId ||
    !["collection", "collection_pool_sweep_abonement", "collection_pool_sweep_goods"].includes(op.type)
  ) {
    return NextResponse.json({ error: "Инкассация не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const before = Math.abs(Number(op.amount));
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
          comment: null,
        },
      }),
    ]);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/money/collections/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  if (
    !op ||
    op.tenantId !== owner.tenantId ||
    !["collection", "collection_pool_sweep_abonement", "collection_pool_sweep_goods"].includes(op.type)
  ) {
    return NextResponse.json({ error: "Инкассация не найдена" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: { amount: Math.abs(Number(op.amount)) },
        afterJson: { deleted: true },
        comment: null,
      },
    }),
    prisma.moneyOperation.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
