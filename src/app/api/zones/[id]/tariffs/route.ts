import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { LAUNCH_PRICING_MODES } from "@/lib/game-room";
import { isStaysZone } from "@/lib/results-calc";

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

  const activeTariffs = await prisma.tariff.findMany({
    where: { zoneId, deletedAt: null },
    select: { order: true },
  });
  if (activeTariffs.length >= 2) {
    return NextResponse.json(
      { error: "У зоны уже максимум 2 тарифа" },
      { status: 409 }
    );
  }
  // @@unique([zoneId, order]) — после soft-delete тарифа с order=1 может
  // остаться активный только с order=2, тогда новому нужен именно order=1,
  // не "count+1" (это дало бы конфликт с уже занятым order=2).
  const usedOrders = new Set(activeTariffs.map((t) => t.order));
  const order = usedOrders.has(1) ? 2 : 1;

  const { name, price, pricingMode, options } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название тарифа обязательно" }, { status: 400 });
  }

  // "За вход"/"По факту" — только у зон "Прибывания" (запрос пользователя
  // 2026-07-17: те же правила и лимит тарифов, что у Счётчиков/Пусков,
  // просто с доп. полями, значимыми только в этом режиме). Минимальная сумма
  // пуска убрана (запрос пользователя того же дня: "вообще не нужна, это
  // лишнее") — roundingMode остаётся "up" для округления длительности,
  // minAmount всегда null у новых тарифов "По факту".
  let pricingModeValue: string | null = null;
  let roundingModeValue: string | null = null;
  let priceNumber = 0;
  const optionsData: { durationMinutes: number; price: number; order: number }[] = [];

  if (isStaysZone(zone)) {
    if (!(LAUNCH_PRICING_MODES as readonly string[]).includes(pricingMode)) {
      return NextResponse.json({ error: "Некорректный тип тарифа" }, { status: 400 });
    }
    pricingModeValue = pricingMode;
    if (pricingMode === "fixed") {
      // Несколько вариантов длительность+цена (запрос пользователя
      // 2026-07-17: "1 час, 2 часа..." — оператор выбирает при старте пуска),
      // а не одна пара — top-level price для "fixed" не используется.
      if (!Array.isArray(options) || options.length === 0) {
        return NextResponse.json({ error: "Добавьте хотя бы один вариант" }, { status: 400 });
      }
      for (const opt of options) {
        const o = opt as { durationMinutes?: unknown; price?: unknown };
        const d = Number(o?.durationMinutes);
        const p = Number(o?.price);
        if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(p) || p < 0) {
          return NextResponse.json({ error: "Некорректный вариант тарифа" }, { status: 400 });
        }
        optionsData.push({ durationMinutes: Math.round(d), price: p, order: optionsData.length });
      }
    } else {
      roundingModeValue = "up";
      priceNumber = Number(price);
      if (!Number.isFinite(priceNumber) || priceNumber < 0) {
        return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
      }
    }
  } else {
    priceNumber = Number(price);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    }
  }

  const tariff = await prisma.$transaction(async (tx) => {
    const created = await tx.tariff.create({
      data: {
        zoneId,
        name: name.trim(),
        price: priceNumber,
        order,
        pricingMode: pricingModeValue,
        roundingMode: roundingModeValue,
        minAmount: null,
      },
    });
    if (optionsData.length > 0) {
      await tx.tariffOption.createMany({
        data: optionsData.map((o) => ({ tariffId: created.id, ...o })),
      });
    }
    return created;
  });

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json(
    { id: tariff.id, name: tariff.name, price: tariff.price, order: tariff.order },
    { status: 201 }
  );
}
