import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { voidGoodsSale } from "@/lib/goods";

// Аннулирование продажи — только владелец (docs/spec/09-goods.md,
// "Аннулирование"). Оператор не может отменить ни одним способом оплаты.
export async function POST(request: Request, ctx: RouteContext<"/api/goods/sale/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
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
      return NextResponse.json({ error: "Продажа уже аннулирована" }, { status: 400 });
    }
    throw err;
  }
}
