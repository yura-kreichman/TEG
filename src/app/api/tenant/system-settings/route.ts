import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Настройки → Система (запрос пользователя 2026-07-20) — пока один тумблер,
// но страница задумана расширяемой ("первый пункт там будет"). Первый:
// разрешена ли клиентам оплата Товаров балансом абонемента
// (docs/spec/09-goods.md, "Продажа") — глобально, на весь тенант.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { goodsAllowBalancePayment: true },
  });

  return NextResponse.json({
    goodsAllowBalancePayment: tenant?.goodsAllowBalancePayment ?? true,
  });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const data: { goodsAllowBalancePayment?: boolean } = {};

  if (body.goodsAllowBalancePayment !== undefined) {
    if (typeof body.goodsAllowBalancePayment !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.goodsAllowBalancePayment = body.goodsAllowBalancePayment;
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  return NextResponse.json({ ok: true });
}
