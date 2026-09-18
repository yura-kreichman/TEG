import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// «···» → «Скрыть» на карточке «Первые шаги» (docs/spec/13-onboarding.md).
// Пройденные шаги прячут карточку и без этого флага — он для тех, кто скрыл
// её раньше, чем закончил настройку.
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  await prisma.tenant.update({
    where: { id: owner.tenantId },
    data: { setupChecklistHiddenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
