import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";

/**
 * Правка и удаление размена (запрос владельца 2026-09-02: «внёс тестовый и
 * удалить не могу»).
 *
 * До этой правки размен можно было только СОЗДАТЬ: DELETE-роута не
 * существовало ни у зонного размена, ни у товарного, а единственным способом
 * убрать ошибочную запись была «Настройки → Очистка данных → Размен», которая
 * стирает ВСЕ размены тенанта разом. То есть цена опечатки — вся история.
 *
 * Проще инкассации: у размена нет ни погашающих строк, ни связи со сдачей
 * итогов — это просто деньги, которые владелец положил в кассу. Поэтому нет и
 * проверки editable, только журнал правок и пересчёт остатков.
 *
 * Оба типа сразу: change_fund (касса зоны) и goods_change_fund (наличные
 * Товаров на точке) — операция одна и та же, знак и формат суммы совпадают.
 */
const CHANGE_FUND_TYPES = ["change_fund", "goods_change_fund"];

async function findOwnOperation(id: string, tenantId: string) {
  const op = await prisma.moneyOperation.findUnique({
    where: { id },
    include: { zone: { select: { pointId: true } } },
  });
  if (!op || op.tenantId !== tenantId || !CHANGE_FUND_TYPES.includes(op.type)) return null;
  return op;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/money/change-fund/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await findOwnOperation(id, owner.tenantId);
  if (!op) {
    return NextResponse.json({ error: "Размен не найден" }, { status: 404 });
  }

  const { amount } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const before = Math.abs(Number(op.amount));
  await prisma.$transaction(async (tx) => {
    // Тот же advisory-lock по точке, что у правки инкассации: остатки кассы
    // считаются суммой операций, и параллельная правка двух строк одной точки
    // может разъехаться.
    // Точка берётся ЧЕРЕЗ ЗОНУ (генеральная проверка финансов
    // 2026-09-02). Прежнее условие `if (op.pointId)` не срабатывало НИКОГДА:
    // CHECK MoneyOperation_zone_xor_point гарантирует, что у зонной операции
    // pointId пуст, а размен и инкассация — зонные. То есть лок, о котором
    // соседний комментарий уверял, что он взят, не брался ни разу.
    const lockPointId = op.pointId ?? op.zone?.pointId ?? null;
    if (lockPointId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockPointId}))`;
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
    await tx.moneyOperation.update({ where: { id }, data: { amount: amountNumber } });
  });

  await resyncAfterMoneyOpChange(op);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/money/change-fund/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await findOwnOperation(id, owner.tenantId);
  if (!op) {
    return NextResponse.json({ error: "Размен не найден" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    // Точка берётся ЧЕРЕЗ ЗОНУ (генеральная проверка финансов
    // 2026-09-02). Прежнее условие `if (op.pointId)` не срабатывало НИКОГДА:
    // CHECK MoneyOperation_zone_xor_point гарантирует, что у зонной операции
    // pointId пуст, а размен и инкассация — зонные. То есть лок, о котором
    // соседний комментарий уверял, что он взят, не брался ни разу.
    const lockPointId = op.pointId ?? op.zone?.pointId ?? null;
    if (lockPointId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockPointId}))`;
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

  await resyncAfterMoneyOpChange(op);

  return NextResponse.json({ ok: true });
}
