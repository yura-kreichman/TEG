import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Настройки → Система (запрос пользователя 2026-07-20) — страница задумана
// расширяемой ("первый пункт там будет"). Тумблеры:
// - goodsAllowBalancePayment: разрешена ли клиентам оплата Товаров балансом
//   (docs/spec/09-goods.md, "Продажа") — глобально, на весь тенант.
// - printingEnabled: общий рубильник будущего модуля печати квитанций (не
//   фискальных чеков) — сам выбор принтера сюда не переедет, он привязан к
//   устройству/точке, не к тенанту (см. комментарий у поля в schema.prisma).
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { goodsAllowBalancePayment: true, printingEnabled: true },
  });

  return NextResponse.json({
    goodsAllowBalancePayment: tenant?.goodsAllowBalancePayment ?? true,
    printingEnabled: tenant?.printingEnabled ?? false,
  });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const data: { goodsAllowBalancePayment?: boolean; printingEnabled?: boolean } = {};

  if (body.goodsAllowBalancePayment !== undefined) {
    if (typeof body.goodsAllowBalancePayment !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.goodsAllowBalancePayment = body.goodsAllowBalancePayment;
  }
  if (body.printingEnabled !== undefined) {
    if (typeof body.printingEnabled !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.printingEnabled = body.printingEnabled;
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  return NextResponse.json({ ok: true });
}
