import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { syncHeldOrderCart } from "@/lib/goods";

interface CartItemInput {
  goodsId?: unknown;
  quantity?: unknown;
}

// Синхронизация уже открытого заказа с новым содержимым корзины (запрос
// пользователя 2026-07-30: "докупить" — это те же товары, поднятые обратно
// в обычную корзину тем же тапом по каталогу, "Отложить" сохраняет заново,
// не отдельный поиск+список). PUT, не POST — тело это ПОЛНОЕ желаемое
// содержимое заказа, не дельта на добавление, см. syncHeldOrderCart.
export async function PUT(request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]/items">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(opCtx.operator.tenantId, "goodsEnabled")) || !opCtx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body.items) ? (body.items as CartItemInput[]) : [];

  const items: { goodsId: string; quantity: number }[] = [];
  for (const item of rawItems) {
    const goodsId = typeof item.goodsId === "string" ? item.goodsId : "";
    const quantity = Number(item.quantity);
    if (!goodsId || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Некорректная позиция" }, { status: 400 });
    }
    items.push({ goodsId, quantity });
  }

  try {
    const order = await syncHeldOrderCart({
      tenantId: opCtx.operator.tenantId,
      pointId: opCtx.point.id,
      orderId: id,
      items,
    });
    // total — сразу в ответе (запрос пользователя 2026-07-30, "Оплатить"
    // сразу после докупки в той же корзине): клиенту нужна СВЕЖАЯ сумма для
    // sheet выбора способа оплаты немедленно, раньше, чем успеет отработать
    // отдельный фоновый GET /held-orders.
    const total = order.lines.reduce((sum, l) => sum + Number(l.priceSnapshot) * l.quantity, 0);
    return NextResponse.json({ id: order.id, number: order.number, total });
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "GOODS_NOT_FOUND") {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }
    throw err;
  }
}
