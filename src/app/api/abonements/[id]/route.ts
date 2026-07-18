import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

async function findOwnedAbonement(tenantId: string, id: string) {
  const abonement = await prisma.abonement.findUnique({ where: { id } });
  if (!abonement || abonement.tenantId !== tenantId || abonement.deletedAt) return null;
  return abonement;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/abonements/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const abonement = await findOwnedAbonement(owner.tenantId, id);
  if (!abonement) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const name: string | null = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const price = Number(body.price);
  const creditAmount = Number(body.creditAmount);

  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "Укажите цену абонемента" }, { status: 400 });
  }
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    return NextResponse.json({ error: "Укажите сумму зачисления" }, { status: 400 });
  }
  if (creditAmount < price) {
    return NextResponse.json({ error: "Зачисление не может быть меньше цены" }, { status: 400 });
  }

  await prisma.abonement.update({
    where: { id },
    data: { name, price, creditAmount },
  });
  return NextResponse.json({ ok: true });
}

// Мягкое удаление (тот же принцип, что Tariff) — прошлые AbonementTransaction
// должны продолжать ссылаться на абонемент, которым когда-то пополнили.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/abonements/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const abonement = await findOwnedAbonement(owner.tenantId, id);
  if (!abonement) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  await prisma.abonement.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
