import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

async function findOwnedReconciliation(tenantId: string, id: string) {
  const reconciliation = await prisma.goodsReconciliation.findUnique({ where: { id } });
  if (!reconciliation || reconciliation.tenantId !== tenantId) return null;
  return reconciliation;
}

// Правка суммы уже сохранённой сдачи кассы (запрос пользователя 2026-07-19:
// "Владелец должен иметь возможность редактировать и удалять Сдачи касс") —
// только actualCash/actualMobile, occurredAt и performedBy не трогаются (это
// исторический факт "кто и когда сдавал", а не то, что редактируется).
export async function PATCH(request: Request, ctx: RouteContext<"/api/goods/reconciliations/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const reconciliation = await findOwnedReconciliation(owner.tenantId, id);
  if (!reconciliation) {
    return NextResponse.json({ error: "Сдача кассы не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const actualCash = Number(body.actualCash);
  const actualMobile = Number(body.actualMobile);
  if (!Number.isFinite(actualCash) || actualCash < 0 || !Number.isFinite(actualMobile) || actualMobile < 0) {
    return NextResponse.json({ error: "Укажите фактические суммы" }, { status: 400 });
  }

  await prisma.goodsReconciliation.update({ where: { id }, data: { actualCash, actualMobile } });
  return NextResponse.json({ ok: true });
}

// Удаление ошибочной сдачи кассы. Следующая по времени сдача этой же точки
// (если есть) при пересчёте своего окна в отчётах естественно "поглотит"
// период удалённой — это правильное поведение корректировки, не баг.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/goods/reconciliations/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const reconciliation = await findOwnedReconciliation(owner.tenantId, id);
  if (!reconciliation) {
    return NextResponse.json({ error: "Сдача кассы не найдена" }, { status: 404 });
  }

  await prisma.goodsReconciliation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
