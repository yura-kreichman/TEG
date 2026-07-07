import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { hashPin } from "@/lib/auth";
import { isPinTakenInTenant } from "@/lib/operator-auth";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/operators/[id]/reset-pin">
) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { pin } = await request.json();

  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { error: "ПИН-код должен состоять из 4-6 цифр" },
      { status: 400 }
    );
  }

  const operator = await prisma.operator.findUnique({ where: { id } });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  if (await isPinTakenInTenant(owner.tenantId, pin, id)) {
    return NextResponse.json(
      { error: "Такой ПИН-код уже занят другим оператором" },
      { status: 409 }
    );
  }

  await prisma.operator.update({
    where: { id },
    data: {
      pinHash: await hashPin(pin),
    },
  });

  return NextResponse.json({ ok: true });
}
