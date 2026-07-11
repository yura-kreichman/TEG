import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

async function findOwnedTariff(tenantId: string, id: string) {
  const tariff = await prisma.tariff.findUnique({
    where: { id },
    include: { zone: { include: { point: true } } },
  });
  if (!tariff || tariff.zone.point.tenantId !== tenantId) return null;
  return tariff;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/tariffs/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tariff = await findOwnedTariff(owner.tenantId, id);
  if (!tariff) {
    return NextResponse.json({ error: "Тариф не найден" }, { status: 404 });
  }

  const { name, price } = await request.json();
  const data: { name?: string; price?: string } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название тарифа обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (price !== undefined) {
    const numericPrice = Number(price);
    if (typeof price !== "string" && typeof price !== "number") {
      return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return NextResponse.json({ error: "Цена должна быть неотрицательным числом" }, { status: 400 });
    }
    data.price = String(price);
  }

  await prisma.tariff.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/tariffs/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tariff = await findOwnedTariff(owner.tenantId, id);
  if (!tariff) {
    return NextResponse.json({ error: "Тариф не найден" }, { status: 404 });
  }

  // Soft-delete — AssetReading.tariffId ссылается на этот тариф без cascade,
  // жёсткое удаление сломало бы FK-constraint для зон с историей сдач (и
  // молча падало 500, фронт эту ошибку не проверял). Отчёты по-прежнему
  // корректны — они читают тарифы зоны без фильтра deletedAt.
  await prisma.tariff.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
