import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { InsufficientBalanceError, spendWalletForZone } from "@/lib/abonement";
import { prisma } from "@/lib/prisma";

// Оплата балансом на зоне без Launch-учёта — "Счётчики" (актив+тариф) и
// "Только касса" (сама зона, без активов) — docs/spec/01-counters.md, запрос
// пользователя 2026-07-20. Независимая ручная фиксация, не связанная с
// самим тиком счётчика/кассой. Кошелёк уже открыт на экране "Клиенты" (тот
// же приём, что у topup рядом).
export async function POST(request: Request, ctx: RouteContext<"/api/operator/abonements/[id]/zone-spend">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id: walletId } = await ctx.params;

  const wallet = await prisma.abonementWallet.findFirst({ where: { id: walletId, tenantId: point.tenantId } });
  if (!wallet) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const assetId: string = typeof body.assetId === "string" ? body.assetId : "";
  const tariffId: string = typeof body.tariffId === "string" ? body.tariffId : "";
  const zoneId: string = typeof body.zoneId === "string" ? body.zoneId : "";
  const amount = Number(body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
  }
  if (!assetId && !zoneId) {
    return NextResponse.json({ error: "Выберите зону" }, { status: 400 });
  }
  if (assetId && !tariffId) {
    return NextResponse.json({ error: "Выберите тариф" }, { status: 400 });
  }

  try {
    const updated = await spendWalletForZone(walletId, {
      tenantId: point.tenantId,
      pointId: point.id,
      operatorId: operator.id,
      amount,
      target: assetId ? { kind: "counterAsset", assetId, tariffId } : { kind: "cashOnlyZone", zoneId },
    });
    return NextResponse.json({
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      balance: Number(updated.balance),
      createdAt: updated.createdAt,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: "Недостаточно средств на балансе" }, { status: 400 });
    }
    if (
      err instanceof Error &&
      (err.message === "ASSET_NOT_FOUND" || err.message === "TARIFF_NOT_FOUND" || err.message === "ZONE_NOT_FOUND")
    ) {
      return NextResponse.json({ error: "Зона, актив или тариф не найдены" }, { status: 400 });
    }
    throw err;
  }
}
