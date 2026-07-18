import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { prisma } from "@/lib/prisma";

// Правка имени существующего абонента оператором (запрос пользователя
// 2026-07-17: "Сотрудник должен иметь возможность... менять имя, в том
// числе у имеющихся") — только имя, телефон/баланс тут не редактируются
// (баланс — только через пополнение, см. topup/route.ts).
export async function PATCH(request: Request, ctx: RouteContext<"/api/operator/abonements/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  const wallet = await prisma.abonementWallet.findFirst({ where: { id, tenantId: point.tenantId } });
  if (!wallet) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const name: string | null = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  const updated = await prisma.abonementWallet.update({ where: { id }, data: { name } });
  return NextResponse.json({
    id: updated.id,
    phone: updated.phone,
    name: updated.name,
    balance: Number(updated.balance),
    createdAt: updated.createdAt,
  });
}
