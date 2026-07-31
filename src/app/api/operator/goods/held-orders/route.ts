import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { holdGoodsCart } from "@/lib/goods";

// Отложенные заказы Товаров (запрос пользователя 2026-07-29: "клиент
// покупает товары, но ещё сидит за столом") — список открытых заказов ЭТОЙ
// точки (GET) и "Отложить" текущей корзины (POST, см. holdGoodsCart в
// lib/goods.ts). Тот же доступ, что и у каталога/продажи Товаров.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.operator.tenantId, "goodsEnabled")) || !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const orders = await prisma.goodsHeldOrder.findMany({
    where: { pointId: ctx.point.id },
    include: {
      lines: { include: { goods: { select: { name: true } } } },
      // Привязка клиента (запрос пользователя 2026-07-31, "по тому же
      // принципу, что в Посещениях") — та же справочная метка, что
      // Launch.linkedClientWallet, нужна и в списке (иконка на чипе), и в
      // sheet правки заказа.
      linkedClientWallet: { select: { id: true, phone: true, name: true, balance: true } },
    },
    // Сначала старые (запрос пользователя 2026-07-30) — не по номеру:
    // номер освобождается/переиспользуется (smallestFreeNumber), поэтому
    // порядок "по номеру" не совпадает с порядком "по времени открытия".
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      label: o.label,
      createdAt: o.createdAt,
      total: o.lines.reduce((sum, l) => sum + Number(l.priceSnapshot) * l.quantity, 0),
      lines: o.lines.map((l) => ({
        goodsId: l.goodsId,
        goodsName: l.goods.name,
        quantity: l.quantity,
        priceSnapshot: Number(l.priceSnapshot),
      })),
      linkedClient: o.linkedClientWallet
        ? {
            id: o.linkedClientWallet.id,
            phone: o.linkedClientWallet.phone,
            name: o.linkedClientWallet.name,
            balance: Number(o.linkedClientWallet.balance),
          }
        : null,
    })),
  });
}

interface CartItemInput {
  goodsId?: unknown;
  quantity?: unknown;
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.operator.tenantId, "goodsEnabled")) || !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body.items) ? (body.items as CartItemInput[]) : [];

  const items: { goodsId: string; quantity: number }[] = [];
  for (const item of rawItems) {
    const goodsId = typeof item.goodsId === "string" ? item.goodsId : "";
    const quantity = Number(item.quantity);
    if (!goodsId || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Некорректная корзина" }, { status: 400 });
    }
    items.push({ goodsId, quantity });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Корзина пуста" }, { status: 400 });
  }

  try {
    const order = await holdGoodsCart({
      tenantId: ctx.operator.tenantId,
      pointId: ctx.point.id,
      items,
      actor: { operatorId: ctx.operator.id },
    });
    return NextResponse.json({ id: order.id, number: order.number }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "GOODS_NOT_FOUND") {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }
    throw err;
  }
}
