import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { getTenantDayContext } from "@/lib/tenant-day";
import { getBusinessDayBounds } from "@/lib/business-day";
import { removeExpenseAlert, resyncExpenseAlert } from "@/lib/expense-alert";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";

/**
 * Правка и удаление своей записи расхода Сотрудником — только записи
 * ТЕКУЩЕГО периода зоны: уже учтённые сдачей итогов отсюда не видны, не
 * правятся и не удаляются.
 *
 * "Текущий период" с 2026-08-15 — это resultsSubmissionId = null у самой
 * операции (см. шапку соседнего route.ts): признак точнее прежнего сравнения
 * времени с границей последней сдачи — та отвечала "когда была сдача", а не
 * "вошла ли в неё ИМЕННО эта строка". Расход, уже привязанный к сдаче,
 * правит и удаляет только Владелец, в реестре расходов.
 *
 * Правка добавлена по требованию владельца 2026-08-19: раньше у Сотрудника
 * была только корзина, и исправление опечатки в сумме означало "удали и
 * заведи заново" — в чате оставалось два сообщения вместо одного
 * исправленного.
 */
async function loadEditableExpense(id: string, pointId: string, tenantId: string) {
  // zone.pointId вместо прежнего собственного pointId записи — у операции
  // журнала точка выводится через зону (CHECK-констрейнт MoneyOperation
  // разрешает заполнить только одно из zoneId/pointId).
  const operation = await prisma.moneyOperation.findFirst({
    where: { id, type: "expense", zone: { pointId } },
    select: {
      id: true,
      tenantId: true,
      zoneId: true,
      pointId: true,
      shiftId: true,
      amount: true,
      occurredAt: true,
      resultsSubmissionId: true,
      expenseAlertMessageId: true,
    },
  });
  if (!operation) return { error: NextResponse.json({ error: "Запись не найдена" }, { status: 404 }) };
  if (operation.resultsSubmissionId) {
    return { error: NextResponse.json({ error: "Эта запись уже учтена в сдаче итогов" }, { status: 409 }) };
  }
  // Своим днём и ограничены: расход, внесённый после сдачи, сотрудник видит
  // до конца бизнес-дня (правило владельца 2026-08-16) — раз из списка он
  // ушёл, то и трогать его отсюда нельзя, иначе по прямому id можно было бы
  // стереть или переписать запись недельной давности. Дальше — только
  // Владелец в реестре.
  const day = await getTenantDayContext(tenantId);
  const bounds = getBusinessDayBounds(day.boundary, new Date(), day.timezone);
  if (operation.occurredAt < bounds.start || operation.occurredAt >= bounds.end) {
    return { error: NextResponse.json({ error: "Этот расход уже вне текущего дня" }, { status: 409 }) };
  }
  return { operation };
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/operator/zone-expense-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id } = await ctx.params;

  const tenant = await prisma.tenant.findUnique({
    where: { id: point.tenantId },
    select: { expensesEnabled: true },
  });
  if (tenant?.expensesEnabled === false) {
    return NextResponse.json({ error: "Расходы отключены владельцем" }, { status: 403 });
  }

  const { operation, error } = await loadEditableExpense(id, point.id, point.tenantId);
  if (error) return error;

  const body = await request.json().catch(() => null);
  const amount = Number(body?.amount);
  const categoryId: string | null = typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;
  const comment: string | null = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
  const zoneId: string = typeof body?.zoneId === "string" && body.zoneId ? body.zoneId : (operation.zoneId ?? "");

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  // Зона — та же проверка доступа, что при создании: сотрудник с выборочным
  // доступом не должен перенести расход в чужую зону.
  const zone = await prisma.zone.findFirst({
    where: {
      id: zoneId,
      pointId: point.id,
      active: true,
      ...(operator.allZonesAccess ? {} : { operatorsWithAccess: { some: { id: operator.id } } }),
    },
    select: { id: true },
  });
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  if (categoryId) {
    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.tenantId !== point.tenantId) {
      return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    }
  }

  await prisma.moneyOperation.update({
    where: { id },
    data: { amount: -Math.abs(amount), expenseCategoryId: categoryId, comment, zoneId },
  });

  // Сообщение владельцу переписываем на месте, без короны: правка своя, не
  // владельческая. Плюс сводки, которые эту сумму суммируют, — "Касса за
  // день" по НОВОЙ зоне и, если расход из неё уехал, по старой.
  await resyncExpenseAlert(id, point.tenantId, { editedByOwner: false }).catch(() => {});
  await resyncAfterMoneyOpChange({ ...operation, zoneId });
  if (zoneId !== operation.zoneId) await resyncAfterMoneyOpChange(operation);

  return NextResponse.json({ ok: true, amount: Math.abs(amount) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/operator/zone-expense-events/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  const { operation, error } = await loadEditableExpense(id, point.id, point.tenantId);
  if (error) return error;

  await prisma.moneyOperation.delete({ where: { id } });

  // Сообщение "Новый расход" уходит вместе с записью — тем же путём, что при
  // удалении Владельцем (требование владельца 2026-08-19: удаляет сотрудник
  // или Владелец — в чате не должно оставаться суммы, которой больше нет).
  await removeExpenseAlert(operation.expenseAlertMessageId, point.tenantId);
  await resyncAfterMoneyOpChange(operation);

  return NextResponse.json({ ok: true });
}
