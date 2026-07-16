import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { getLaunchPricingAt, LAUNCH_PRICING_MODES, LAUNCH_ROUNDING_MODES } from "@/lib/game-room";

// Тариф зоны "Игровой комнаты" (docs/spec/04-game-room.md) — история,
// append-only (см. LaunchPricing в schema.prisma), тот же паттерн, что
// история ставок оператора (05-work-time.md). GET отдаёт действующий тариф
// "на сейчас", POST добавляет новую запись (не редактирует старую).

export async function GET(_request: Request, ctx: RouteContext<"/api/zones/[id]/launch-pricing">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const [pricing, historyRows] = await Promise.all([
    getLaunchPricingAt(zoneId, new Date()),
    prisma.launchPricing.findMany({ where: { zoneId }, orderBy: { effectiveFrom: "desc" }, take: 20 }),
  ]);

  const history = historyRows.map((p) => ({
    id: p.id,
    pricingMode: p.pricingMode,
    price: Number(p.price),
    durationMinutes: p.durationMinutes,
    roundingMode: p.roundingMode,
    minAmount: p.minAmount != null ? Number(p.minAmount) : null,
    effectiveFrom: p.effectiveFrom,
  }));

  if (!pricing) return NextResponse.json({ pricing: null, history });

  return NextResponse.json({
    pricing: {
      pricingMode: pricing.pricingMode,
      price: Number(pricing.price),
      durationMinutes: pricing.durationMinutes,
      roundingMode: pricing.roundingMode,
      minAmount: pricing.minAmount != null ? Number(pricing.minAmount) : null,
      effectiveFrom: pricing.effectiveFrom,
    },
    history,
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/launch-pricing">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { pricingMode, price, durationMinutes, roundingMode, minAmount } = await request.json();

  if (!(LAUNCH_PRICING_MODES as readonly string[]).includes(pricingMode)) {
    return NextResponse.json({ error: "Некорректный тип тарифа" }, { status: 400 });
  }
  const priceNumber = Number(price);
  if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
    return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
  }

  let durationMinutesValue: number | null = null;
  let roundingModeValue: string | null = null;
  let minAmountValue: number | null = null;

  if (pricingMode === "fixed") {
    if (durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== "") {
      const d = Number(durationMinutes);
      if (!Number.isFinite(d) || d <= 0) {
        return NextResponse.json({ error: "Некорректная длительность" }, { status: 400 });
      }
      durationMinutesValue = Math.round(d);
    }
  } else {
    if (!(LAUNCH_ROUNDING_MODES as readonly string[]).includes(roundingMode)) {
      return NextResponse.json({ error: "Некорректное округление" }, { status: 400 });
    }
    roundingModeValue = roundingMode;
    if (minAmount !== undefined && minAmount !== null && minAmount !== "") {
      const m = Number(minAmount);
      if (!Number.isFinite(m) || m < 0) {
        return NextResponse.json({ error: "Некорректная минимальная сумма" }, { status: 400 });
      }
      minAmountValue = m;
    }
  }

  const created = await prisma.launchPricing.create({
    data: {
      zoneId,
      pricingMode,
      price: priceNumber,
      durationMinutes: durationMinutesValue,
      roundingMode: roundingModeValue,
      minAmount: minAmountValue,
    },
  });

  return NextResponse.json({ id: created.id, effectiveFrom: created.effectiveFrom }, { status: 201 });
}
