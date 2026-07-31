import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { cancelGoodsHeldOrder } from "@/lib/goods";

// Переименование заказа (запрос пользователя 2026-07-30: "Стол Васи" и
// т.п.) — своё имя поверх номера, номер остаётся ключом/цветом. Пустая
// строка — сброс к дефолтному "Заказ N" (label: null), не пустая строка в БД.
export async function PATCH(request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(opCtx.operator.tenantId, "goodsEnabled")) || !opCtx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;

  const order = await prisma.goodsHeldOrder.findFirst({ where: { id, tenantId: opCtx.operator.tenantId, pointId: opCtx.point.id } });
  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  await prisma.goodsHeldOrder.update({ where: { id }, data: { label } });
  return NextResponse.json({ ok: true });
}

// "Удалить" отложенный заказ — возвращает списанный остаток (в отличие от
// очистки обычного черновика корзины, тут есть что реально откатывать, см.
// cancelGoodsHeldOrder в lib/goods.ts). Сценарий "клиент ушёл не
// расплатившись" отдельно не рассматриваем (решение пользователя
// 2026-07-29) — это и есть ручное удаление, доступное самому оператору, как
// и сейчас у обычной корзины.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(opCtx.operator.tenantId, "goodsEnabled")) || !opCtx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const { id } = await ctx.params;
  try {
    await cancelGoodsHeldOrder(id, opCtx.operator.tenantId, opCtx.point.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    throw err;
  }
}
