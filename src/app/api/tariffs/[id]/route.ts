import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { LAUNCH_PRICING_MODES } from "@/lib/game-room";
import { isStaysZone } from "@/lib/results-calc";

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

  const { name, price, pricingMode, options } = await request.json();
  const data: {
    name?: string;
    price?: string;
    pricingMode?: string;
    roundingMode?: string | null;
    minAmount?: number | null;
  } = {};
  // Варианты "За вход" — полная замена набора при сохранении (запрос
  // пользователя 2026-07-17: "можно добавлять, удалять и редактировать эти
  // опции"), проще, чем точечный diff по id, и достаточно для реалистичных
  // 2-4 вариантов на тариф. undefined — не трогать options вообще (например,
  // PATCH только name).
  let optionsData: { durationMinutes: number; price: number; order: number }[] | undefined;

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название тарифа обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }

  // pricingMode/минималка/варианты — только у тарифов зон "Прибывания";
  // у обычных зоновых тарифов (counters/launches) эти поля не применяются,
  // там цена приходит через price ниже, как и раньше.
  if (pricingMode !== undefined) {
    if (!isStaysZone(tariff.zone)) {
      return NextResponse.json({ error: "Этот тариф не принадлежит зоне режима «Прибывания»" }, { status: 400 });
    }
    if (!(LAUNCH_PRICING_MODES as readonly string[]).includes(pricingMode)) {
      return NextResponse.json({ error: "Некорректный тип тарифа" }, { status: 400 });
    }
    data.pricingMode = pricingMode;
    if (pricingMode === "fixed") {
      if (!Array.isArray(options) || options.length === 0) {
        return NextResponse.json({ error: "Добавьте хотя бы один вариант" }, { status: 400 });
      }
      optionsData = [];
      for (const opt of options) {
        const o = opt as { durationMinutes?: unknown; price?: unknown };
        const d = Number(o?.durationMinutes);
        const p = Number(o?.price);
        if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(p) || p < 0) {
          return NextResponse.json({ error: "Некорректный вариант тарифа" }, { status: 400 });
        }
        optionsData.push({ durationMinutes: Math.round(d), price: p, order: optionsData.length });
      }
      data.roundingMode = null;
      data.minAmount = null;
      data.price = "0";
    } else {
      // Минимальная сумма пуска убрана (запрос пользователя 2026-07-17:
      // "вообще не нужна, это лишнее") — всегда null у "По факту".
      data.roundingMode = "up";
      data.minAmount = null;
      optionsData = [];
      if (price !== undefined) {
        const numericPrice = Number(price);
        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
          return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
        }
        data.price = String(price);
      }
    }
  } else if (price !== undefined) {
    const numericPrice = Number(price);
    if (typeof price !== "string" && typeof price !== "number") {
      return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return NextResponse.json({ error: "Цена должна быть неотрицательным числом" }, { status: 400 });
    }
    data.price = String(price);
  }

  await prisma.$transaction(async (tx) => {
    await tx.tariff.update({ where: { id }, data });
    if (optionsData !== undefined) {
      await tx.tariffOption.deleteMany({ where: { tariffId: id } });
      if (optionsData.length > 0) {
        await tx.tariffOption.createMany({
          data: optionsData.map((o) => ({ tariffId: id, ...o })),
        });
      }
    }
  });
  await revalidateLandingForTenant(owner.tenantId);
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
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
