import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { voidAbonementSale } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";
import { prisma } from "@/lib/prisma";

// Аннулирование продажи абонемента — только владелец, только целиком
// (решение владельца 2026-08-16: править продажу нельзя, ошибку исправляют
// удалением и продажей заново). Оператор такого действия не имеет вовсе.
export async function POST(_request: Request, ctx: RouteContext<"/api/abonement-sales/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  // Точку и день читаем ДО аннулирования: они нужны, чтобы пересобрать уже
  // отправленную сводку "Касса за день" — выручка этого дня изменилась.
  const sale = await prisma.abonementTransaction.findFirst({
    where: { id, type: "topup", wallet: { tenantId: owner.tenantId } },
    select: { pointId: true, occurredAt: true },
  });

  try {
    await voidAbonementSale(id, owner.tenantId, owner.user.id);
  } catch (err) {
    if (err instanceof Error && err.message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Продажа не найдена" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "ALREADY_VOIDED") {
      // 409 — конфликт состояния, как у остальных аннулирований проекта.
      return NextResponse.json({ error: "Продажа уже аннулирована" }, { status: 409 });
    }
    if (err instanceof Error && err.message === "LEGACY_SPLIT") {
      return NextResponse.json(
        { error: "Продажу с разбивкой оплаты, сделанную до 16.08.2026, аннулировать нельзя" },
        { status: 409 }
      );
    }
    throw err;
  }

  if (sale?.pointId) {
    await resyncAfterMoneyOpChange({
      tenantId: owner.tenantId,
      pointId: sale.pointId,
      zoneId: null,
      shiftId: null,
      occurredAt: sale.occurredAt,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
