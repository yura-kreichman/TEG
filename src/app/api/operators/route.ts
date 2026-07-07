import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { hashPin } from "@/lib/auth";
import { isPinTakenInTenant } from "@/lib/operator-auth";

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const operators = await prisma.operator.findMany({
    where: { tenantId: owner.tenantId },
    select: {
      id: true,
      name: true,
      active: true,
      avatarUrl: true,
      allZonesAccess: true,
      allowedZones: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ operators });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { name, pin } = await request.json();

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Имя оператора обязательно" }, { status: 400 });
  }
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { error: "ПИН-код должен состоять из 4-6 цифр" },
      { status: 400 }
    );
  }

  const operatorCount = await prisma.operator.count({ where: { tenantId: owner.tenantId } });
  const pkg = await prisma.tenant
    .findUnique({ where: { id: owner.tenantId }, include: { package: true } })
    .then((t) => t?.package);
  if (pkg && operatorCount >= pkg.maxOperators) {
    return NextResponse.json(
      { error: `Достигнут лимит операторов по вашему пакету (${pkg.maxOperators})` },
      { status: 409 }
    );
  }

  if (await isPinTakenInTenant(owner.tenantId, pin)) {
    return NextResponse.json(
      { error: "Такой ПИН-код уже занят другим оператором" },
      { status: 409 }
    );
  }

  const operator = await prisma.operator.create({
    data: {
      tenantId: owner.tenantId,
      name: name.trim(),
      pinHash: await hashPin(pin),
      createdByUserId: owner.user.id,
    },
  });

  return NextResponse.json(
    { id: operator.id, name: operator.name, active: operator.active },
    { status: 201 }
  );
}
