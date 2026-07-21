import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantAsset, requireOwner } from "@/lib/require-owner";

interface VariantInput {
  name?: unknown;
  price?: unknown;
}

/**
 * Варианты цен актива (docs/spec/10-tickets.md, "ЦЕНЫ — НА АКТИВАХ, НЕ
 * ТАРИФЫ") — полная замена набора при сохранении, тот же приём, что
 * TariffOption у тарифов "За вход" (src/app/api/tariffs/[id]/route.ts):
 * проще точечного diff по id, достаточно для реалистичных 2-6 вариантов на
 * актив. Минимум один вариант обязателен — актив без единого варианта не
 * может попасть в заказ.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/assets/[id]/ticket-variants">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: assetId } = await ctx.params;
  const asset = await findTenantAsset(owner.tenantId, assetId);
  if (!asset) {
    return NextResponse.json({ error: "Актив не найден" }, { status: 404 });
  }

  const { variants } = await request.json().catch(() => ({}));
  if (!Array.isArray(variants) || variants.length === 0) {
    return NextResponse.json({ error: "Добавьте хотя бы один вариант" }, { status: 400 });
  }

  const data: { name: string; price: number; order: number }[] = [];
  for (const v of variants as VariantInput[]) {
    const name = typeof v?.name === "string" ? v.name.trim() : "";
    const price = Number(v?.price);
    if (!name) {
      return NextResponse.json({ error: "У каждого варианта должно быть название" }, { status: 400 });
    }
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "Некорректная цена варианта" }, { status: 400 });
    }
    data.push({ name, price, order: data.length });
  }

  // Soft-delete, не hard-delete (докс: "смена/удаление вариантов не трогает
  // проданное" — Ticket хранит снапшот, не FK на TicketVariant, поэтому
  // hard-delete был бы безопасен для целостности данных, но здесь мягкое
  // удаление всё равно правильнее — тот же принцип аккуратности с историей,
  // что у Tariff/Abonement, на случай будущей аналитики "какие варианты
  // когда-либо существовали у актива").
  await prisma.$transaction(async (tx) => {
    await tx.ticketVariant.updateMany({
      where: { assetId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await tx.ticketVariant.createMany({
      data: data.map((v) => ({ assetId, ...v })),
    });
  });

  return NextResponse.json({ ok: true });
}
