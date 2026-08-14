import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { checkCollectionAdvanceEditable, reverseCollectionAdvanceSettlement } from "@/lib/zone-balance";

// Отказ в правке "Авансовой инкассации": код клиент переводит сам
// (money.collectionSettledCannotEdit), строка — запасной вариант, если он
// придёт из старой версии приложения.
const SETTLED_UNLINKED = {
  code: "collection_settled_unlinked",
  error: "Погашение этой авансовой инкассации не связано со строкой — исправить сумму нельзя",
};
const MACHINE_ROW = {
  code: "collection_machine_row",
  error: "Это служебная строка погашения, она правится только через исходную инкассацию",
};

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
    !["collection", "collection_pool_sweep_abonement", "collection_pool_sweep_goods", "collection_advance"].includes(op.type)
  ) {
    return NextResponse.json({ error: "Инкассация не найдена" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const editable = await checkCollectionAdvanceEditable(op);
  if (editable === "machine") return NextResponse.json(MACHINE_ROW, { status: 409 });
  if (editable === "settled_unlinked") return NextResponse.json(SETTLED_UNLINKED, { status: 409 });

  const before = Math.abs(Number(op.amount));
  if (before !== amountNumber) {
    // Всё одной транзакцией под тем же advisory-локом точки, что держит
    // погашение (lib/zone-balance.ts): иначе сдача итогов, совпавшая по
    // времени, погасит инкассацию по старой сумме между откатом и правкой.
    await prisma.$transaction(async (tx) => {
      if (op.pointId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.pointId}))`;
      // Снимаем автопогашение до правки — непогашенный остаток пересчитается
      // из истории сам, и следующая сдача погасит уже новую сумму.
      if (op.type === "collection_advance") await reverseCollectionAdvanceSettlement(tx, id);
      await tx.moneyOperation.update({ where: { id }, data: { amount: -amountNumber } });
      await tx.correctionLog.create({
        data: {
          entityType: "MoneyOperation",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: { amount: before },
          afterJson: { amount: amountNumber },
          comment: null,
        },
      });
    });
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
    !["collection", "collection_pool_sweep_abonement", "collection_pool_sweep_goods", "collection_advance"].includes(op.type)
  ) {
    return NextResponse.json({ error: "Инкассация не найдена" }, { status: 404 });
  }

  const editable = await checkCollectionAdvanceEditable(op);
  if (editable === "machine") return NextResponse.json(MACHINE_ROW, { status: 409 });
  if (editable === "settled_unlinked") return NextResponse.json(SETTLED_UNLINKED, { status: 409 });

  await prisma.$transaction(async (tx) => {
    if (op.pointId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.pointId}))`;
    // См. тот же комментарий в PATCH выше: погашающие строки уходят вместе с
    // инкассацией, иначе они навсегда занижают остатки зон.
    if (op.type === "collection_advance") await reverseCollectionAdvanceSettlement(tx, id);
    await tx.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: { amount: Math.abs(Number(op.amount)) },
        afterJson: { deleted: true },
        comment: null,
      },
    });
    await tx.moneyOperation.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
