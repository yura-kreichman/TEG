import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { voidGoodsSale } from "@/lib/goods";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Аннулирование продажи — только владелец (docs/spec/09-goods.md,
// "Аннулирование"). Оператор не может отменить ни одним способом оплаты.
export async function POST(request: Request, ctx: RouteContext<"/api/goods/sale/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const reason: string | null = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  try {
    await voidGoodsSale(id, owner.tenantId, owner.user.id, reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Продажа не найдена" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "ALREADY_VOIDED") {
      // 409, не 400 (аудит 2026-07-26) — та же CAS-гонка двойного клика, что
      // у /api/launches/[id]/void, /api/tickets/[id]/void, /api/ticket-orders/[id]/void
      // — везде остальных три "уже аннулировано" маппится в 409 (конфликт
      // состояния), этот роут был единственным выбросом на 400.
      return NextResponse.json({ error: "Продажа уже аннулирована" }, { status: 409 });
    }
    throw err;
  }
}
