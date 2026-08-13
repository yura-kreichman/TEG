import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { findWalletByPhone, findWalletCandidatesByKey, createWalletEmpty, normalizePhone } from "@/lib/abonement";

async function checkAccess(id: string, opCtx: NonNullable<Awaited<ReturnType<typeof requireOperator>>>) {
  const { operator, point } = opCtx;
  if (!(await isModuleEnabled(point.tenantId, "goodsEnabled")) || !operator.goodsAccess) {
    return { error: "Нет доступа к товарам", status: 403 } as const;
  }
  const order = await prisma.goodsHeldOrder.findUnique({ where: { id }, select: { pointId: true } });
  if (!order || order.pointId !== point.id) return { error: "Заказ не найден", status: 404 } as const;
  return null;
}

/**
 * Привязка клиента к отложенному заказу Товаров (запрос пользователя
 * 2026-07-31: "абсолютно по тому же принципу, что в Посещениях") — тот же
 * контракт GET(поиск по телефону)/POST(привязать)/DELETE(отвязать), что у
 * /api/launches/[id]/link-client, переиспользуется тем же LinkClientSheet.
 * Справочная метка, не способ оплаты — см. GoodsHeldOrder.linkedClientWalletId
 * в schema.prisma.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]/link-client">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(opCtx.point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const access = await checkAccess(id, opCtx);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  const phone = new URL(request.url).searchParams.get("phone") ?? "";
  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }
  const wallet = await findWalletByPhone(opCtx.point.tenantId, phone);
  // Похожие по хвосту номера, когда точного совпадения нет — тот же приём,
  // что на экране Клиентов (запрос пользователя 2026-08-13, реальный баг с
  // прода: сотрудник искал 077942424 и 77942424, клиент в базе сохранён как
  // 37377942424, и привязка предлагала завести дубликат).
  const similar = wallet ? [] : await findWalletCandidatesByKey(opCtx.point.tenantId, phone);
  return NextResponse.json({
    client: wallet ? { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) } : null,
    similar: similar.map((c) => ({ id: c.id, phone: c.phone, name: c.name, balance: Number(c.balance) })),
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]/link-client">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const access = await checkAccess(id, opCtx);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { walletId, phone, name } = await request.json().catch(() => ({}));

  let wallet;
  if (typeof walletId === "string" && walletId) {
    wallet = await prisma.abonementWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.tenantId !== point.tenantId) {
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    }
  } else if (typeof phone === "string" && normalizePhone(phone)) {
    const trimmedName = typeof name === "string" ? name.trim() : "";
    wallet = await createWalletEmpty(phone, trimmedName || null, point.tenantId);
  } else {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  await prisma.goodsHeldOrder.update({ where: { id }, data: { linkedClientWalletId: wallet.id } });

  return NextResponse.json({ id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) });
}

// Убрать привязку — не удаляет клиента, только снимает метку с заказа.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/operator/goods/held-orders/[id]/link-client">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const access = await checkAccess(id, opCtx);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  await prisma.goodsHeldOrder.update({ where: { id }, data: { linkedClientWalletId: null } });
  return NextResponse.json({ ok: true });
}
