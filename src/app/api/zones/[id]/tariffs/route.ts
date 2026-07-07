import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";

export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/tariffs">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const existingTariffs = await prisma.tariff.count({ where: { zoneId } });
  if (existingTariffs >= 2) {
    return NextResponse.json(
      { error: "У зоны уже максимум 2 тарифа" },
      { status: 409 }
    );
  }

  const { name, price } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название тарифа обязательно" }, { status: 400 });
  }
  const priceNumber = Number(price);
  if (!Number.isFinite(priceNumber) || priceNumber < 0) {
    return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
  }

  const tariff = await prisma.tariff.create({
    data: {
      zoneId,
      name: name.trim(),
      price: priceNumber,
      order: existingTariffs + 1,
    },
  });

  return NextResponse.json(
    { id: tariff.id, name: tariff.name, price: tariff.price, order: tariff.order },
    { status: 201 }
  );
}
