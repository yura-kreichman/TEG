import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  // deleteMany, не delete — endpoint принадлежит другому тенанту/владельцу,
  // тихо ничего не делаем, вместо 404/500 на чужой ресурс.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, tenantId: owner.tenantId } });

  return NextResponse.json({ ok: true });
}
