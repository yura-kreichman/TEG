import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { MODULE_KEYS } from "@/lib/modules";

// Точечный оверрайд модуля для тенанта ("индивидуальные условия",
// docs/spec/00-architecture.md) — побеждает набор модулей пакета, см. isModuleEnabled().
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/tenants/[id]/modules">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id: tenantId } = await ctx.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const { moduleKey, enabled } = await request.json();
  if (!MODULE_KEYS.includes(moduleKey)) {
    return NextResponse.json({ error: "Некорректный модуль" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled обязателен" }, { status: 400 });
  }

  await prisma.tenantModule.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
    create: { tenantId, moduleKey, enabled },
    update: { enabled },
  });

  return NextResponse.json({ ok: true });
}

// Убрать оверрайд — вернуться к тому, что даёт пакет.
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/tenants/[id]/modules">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id: tenantId } = await ctx.params;
  const { moduleKey } = await request.json();
  if (!MODULE_KEYS.includes(moduleKey)) {
    return NextResponse.json({ error: "Некорректный модуль" }, { status: 400 });
  }

  await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey } });
  return NextResponse.json({ ok: true });
}
