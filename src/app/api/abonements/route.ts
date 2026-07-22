import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Абонементы (тариф-планы владельца, запрос пользователя 2026-07-17:
// "заплатить 300 → зачислить 350"; переименовано из отдельных "Пакет"/
// "Абонемент" — владелец воспринимает план как "абонемент", кошелёк клиента
// (AbonementWallet) появляется только как побочный эффект покупки плана
// оператором, владелец его вручную не создаёт/не редактирует). До какого-либо
// лимита не ограничено (в отличие от тарифов зоны, тут нет "до 2х").
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const abonements = await prisma.abonement.findMany({
    where: { tenantId: owner.tenantId, deletedAt: null },
    orderBy: { order: "asc" },
  });

  return NextResponse.json({
    abonements: abonements.map((a) => ({
      id: a.id,
      name: a.name,
      price: Number(a.price),
      creditAmount: Number(a.creditAmount),
    })),
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
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
  // Зачисленный баланс не может быть меньше цены (запрос пользователя
  // 2026-07-17) — иначе это не бонус клиенту, а скрытая недостача.
  if (creditAmount < price) {
    return NextResponse.json({ error: "Зачисление не может быть меньше цены" }, { status: 400 });
  }

  const count = await prisma.abonement.count({ where: { tenantId: owner.tenantId, deletedAt: null } });
  const abonement = await prisma.abonement.create({
    data: {
      tenantId: owner.tenantId,
      name,
      price,
      creditAmount,
      order: count,
    },
  });

  return NextResponse.json(
    {
      id: abonement.id,
      name: abonement.name,
      price: Number(abonement.price),
      creditAmount: Number(abonement.creditAmount),
    },
    { status: 201 }
  );
}
