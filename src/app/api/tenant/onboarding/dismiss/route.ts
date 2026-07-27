import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// "Начну с нуля" — тот же флаг, что и после установки демо-данных (см.
// install-demo/route.ts), просто без единой созданной сущности. Без этого
// шторка показывалась бы на каждый вход, пока у тенанта действительно нет
// ни одной точки.
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  await prisma.tenant.update({
    where: { id: owner.tenantId },
    data: { onboardingDismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
