import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

// Point list for the "Сменить точку" picker on roaming devices — only makes
// sense to call from a roaming device, but any operator in the tenant can see
// the tenant's own point names regardless (not sensitive data).
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const points = await prisma.point.findMany({
    where: { tenantId: ctx.point.tenantId },
    select: { id: true, name: true, iconKey: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ points });
}
