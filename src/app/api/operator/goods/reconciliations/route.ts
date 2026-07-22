import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { calculateGoodsCashSince, reconcileGoodsCash } from "@/lib/goods";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Сверка кассы — оператор только с тумблером goodsAccess
// (docs/spec/09-goods.md, "Доступ"), по своей точке (устройство).
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.operator.tenantId, "goodsEnabled")) || !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const pending = await calculateGoodsCashSince(ctx.operator.tenantId, ctx.point.id);
  return NextResponse.json({ pending });
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.operator.tenantId, "goodsEnabled")) || !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к товарам" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const actualCash = Number(body.actualCash);
  const actualMobile = Number(body.actualMobile);

  if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) {
    return NextResponse.json({ error: "Укажите фактические суммы" }, { status: 400 });
  }

  const reconciliation = await reconcileGoodsCash({
    tenantId: ctx.operator.tenantId,
    pointId: ctx.point.id,
    actualCash,
    actualMobile,
    actor: { operatorId: ctx.operator.id },
  });
  return NextResponse.json({ id: reconciliation.id }, { status: 201 });
}
