import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { InsufficientBalanceError, spendWalletForZone } from "@/lib/abonement";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/tenant-modules";

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
  if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const { id: walletId } = await ctx.params;

  const wallet = await prisma.abonementWallet.findFirst({ where: { id: walletId, tenantId: point.tenantId } });
  if (!wallet) {
    return NextResponse.json({ error: "Абонемент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const zoneId: string = typeof body.zoneId === "string" ? body.zoneId : "";
  // "Счётчики" — несколько строк тариф+количество (запрос пользователя
  // 2026-07-24: "чтобы Сотрудник мог списывать сразу несколько тарифов",
  // степпер, как у Билетов); "Только касса" — по-прежнему одна свободная
  // сумма, у неё тарифов нет вовсе.
  const rawLines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines
    .map((l) =>
      l && typeof l === "object" && typeof (l as { tariffId?: unknown }).tariffId === "string"
        ? { tariffId: (l as { tariffId: string }).tariffId, quantity: Number((l as { quantity?: unknown }).quantity) }
        : null
    )
    .filter((l): l is { tariffId: string; quantity: number } => l !== null && Number.isInteger(l.quantity) && l.quantity > 0);
  const amount = Number(body.amount);

  if (!zoneId) {
    return NextResponse.json({ error: "Выберите зону" }, { status: 400 });
  }
  if (lines.length === 0 && (!Number.isFinite(amount) || amount <= 0)) {
    return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
  }

  try {
    const updated = await spendWalletForZone(walletId, {
      tenantId: point.tenantId,
      pointId: point.id,
      operatorId: operator.id,
      target: lines.length > 0 ? { kind: "counterTariff", zoneId, lines } : { kind: "cashOnlyZone", zoneId, amount },
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
    if (err instanceof Error && (err.message === "TARIFF_NOT_FOUND" || err.message === "ZONE_NOT_FOUND")) {
      return NextResponse.json({ error: "Зона или тариф не найдены" }, { status: 400 });
    }
    if (err instanceof Error && err.message === "EMPTY_CART") {
      return NextResponse.json({ error: "Выберите хотя бы один тариф" }, { status: 400 });
    }
    throw err;
  }
}
