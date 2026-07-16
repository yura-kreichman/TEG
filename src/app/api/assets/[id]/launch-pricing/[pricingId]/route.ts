import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantAsset, requireOwner } from "@/lib/require-owner";
import { LAUNCH_PRICING_MODES } from "@/lib/game-room";

// Правка/удаление ОТДЕЛЬНОЙ записи истории тарифа актива (запрос пользователя
// 2026-07-16) — безопасно для любой записи, не только последней: стоимость
// каждого пуска фиксируется снапшотом полей на Launch в момент старта
// (см. src/lib/game-room.ts, computeLaunchAmount), не читается из
// LaunchPricing заново. Журнал правок — как везде, через CorrectionLog.

async function findOwnedPricing(tenantId: string, assetId: string, pricingId: string) {
  const asset = await findTenantAsset(tenantId, assetId);
  if (!asset) return null;
  const pricing = await prisma.launchPricing.findUnique({ where: { id: pricingId } });
  if (!pricing || pricing.assetId !== assetId) return null;
  return pricing;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/assets/[id]/launch-pricing/[pricingId]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id: assetId, pricingId } = await ctx.params;
  const pricing = await findOwnedPricing(owner.tenantId, assetId, pricingId);
  if (!pricing) {
    return NextResponse.json({ error: "Запись тарифа не найдена" }, { status: 404 });
  }

  const { pricingMode, price, durationMinutes, minAmount } = await request.json();

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
    roundingModeValue = "up";
    const m = Number(minAmount);
    if (!Number.isFinite(m) || m <= 0) {
      return NextResponse.json({ error: "Минимальная сумма пуска обязательна" }, { status: 400 });
    }
    minAmountValue = m;
  }

  const before = {
    pricingMode: pricing.pricingMode,
    price: Number(pricing.price),
    durationMinutes: pricing.durationMinutes,
    roundingMode: pricing.roundingMode,
    minAmount: pricing.minAmount != null ? Number(pricing.minAmount) : null,
  };
  const after = {
    pricingMode,
    price: priceNumber,
    durationMinutes: durationMinutesValue,
    roundingMode: roundingModeValue,
    minAmount: minAmountValue,
  };

  await prisma.$transaction([
    prisma.launchPricing.update({
      where: { id: pricingId },
      data: after,
    }),
    prisma.correctionLog.create({
      data: {
        entityType: "LaunchPricing",
        entityId: pricingId,
        correctedByUserId: owner.user.id,
        beforeJson: before,
        afterJson: after,
        comment: null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/assets/[id]/launch-pricing/[pricingId]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id: assetId, pricingId } = await ctx.params;
  const pricing = await findOwnedPricing(owner.tenantId, assetId, pricingId);
  if (!pricing) {
    return NextResponse.json({ error: "Запись тарифа не найдена" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.launchPricing.delete({ where: { id: pricingId } }),
    prisma.correctionLog.create({
      data: {
        entityType: "LaunchPricing",
        entityId: pricingId,
        correctedByUserId: owner.user.id,
        beforeJson: {
          pricingMode: pricing.pricingMode,
          price: Number(pricing.price),
          durationMinutes: pricing.durationMinutes,
          roundingMode: pricing.roundingMode,
          minAmount: pricing.minAmount != null ? Number(pricing.minAmount) : null,
        },
        afterJson: { deleted: true },
        comment: null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
