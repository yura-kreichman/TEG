import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

/**
 * Правка/удаление расхода владельцем прямо в реестре (запрос пользователя
 * 2026-08-15). Сотрудник может исправить свою запись только до сдачи итогов
 * (api/operator/zone-expense-events/[id]) — после неё, а также по любому
 * чужому расходу, это может лишь Владелец. Журнал правок — тот же, что у
 * инкассаций и авансов/премий: было → стало, entityType "MoneyOperation".
 *
 * Правится сумма, категория и комментарий; зона и время ввода — нет:
 * "перевесить" расход на другую зону значит переложить деньги между кассами
 * задним числом, для этого есть удаление и новая запись.
 */
async function loadExpense(id: string, tenantId: string) {
  const op = await prisma.moneyOperation.findUnique({ where: { id } });
  if (!op || op.tenantId !== tenantId || op.type !== "expense") return null;
  return op;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/money/expenses/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await loadExpense(id, owner.tenantId);
  if (!op) {
    return NextResponse.json({ error: "Расход не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const amountNumber = Math.abs(Number(body?.amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }
  const categoryId: string | null =
    typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;
  const comment: string | null =
    typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;

  // Чужая категория — тот же класс проверки, что в роуте Сотрудника: без неё
  // подсунутый id упал бы FK-ошибкой уже внутри записи.
  if (categoryId) {
    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.tenantId !== owner.tenantId) {
      return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    }
  }

  const before = {
    amount: Math.abs(Number(op.amount)),
    categoryId: op.expenseCategoryId,
    comment: op.comment,
  };
  const after = { amount: amountNumber, categoryId, comment };
  const unchanged =
    before.amount === after.amount && before.categoryId === after.categoryId && before.comment === after.comment;
  if (unchanged) return NextResponse.json({ ok: true });

  await prisma.$transaction(async (tx) => {
    await tx.moneyOperation.update({
      where: { id },
      data: { amount: -amountNumber, expenseCategoryId: categoryId, comment },
    });
    await tx.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: after,
        comment: null,
      },
    });
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/money/expenses/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const op = await loadExpense(id, owner.tenantId);
  if (!op) {
    return NextResponse.json({ error: "Расход не найден" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctionLog.create({
      data: {
        entityType: "MoneyOperation",
        entityId: id,
        correctedByUserId: owner.user.id,
        beforeJson: {
          amount: Math.abs(Number(op.amount)),
          categoryId: op.expenseCategoryId,
          comment: op.comment,
        },
        afterJson: { deleted: true },
        comment: null,
      },
    });
    await tx.moneyOperation.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
