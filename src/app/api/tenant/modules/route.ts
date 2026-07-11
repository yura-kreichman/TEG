import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { getEnabledModules } from "@/lib/modules";

// Включённые модули СВОЕГО тенанта — для нижнего бара кабинета владельца
// (docs/spec/00-architecture.md, "Навигация": состав бара собирается из
// включённых модулей). Отдельно от /api/admin/tenants/[id]/modules — тот
// эндпоинт для Super Admin, правит модули ЧУЖОГО тенанта.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const modules = await getEnabledModules(owner.tenantId);
  return NextResponse.json(modules);
}
