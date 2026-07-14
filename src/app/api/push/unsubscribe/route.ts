import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePushIdentity } from "@/lib/push-identity";

export async function POST(request: Request) {
  const identity = await resolvePushIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  // deleteMany, не delete — endpoint принадлежит другому тенанту/пользователю,
  // тихо ничего не делаем, вместо 404/500 на чужой ресурс.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, tenantId: identity.tenantId } });

  return NextResponse.json({ ok: true });
}
