import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId, hashPin } from "@/lib/auth";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Требуется вход в систему" }, { status: 401 });
  }

  const { pin } = await request.json();
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { error: "ПИН-код должен состоять из 4-6 цифр" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      pinHash: await hashPin(pin),
      failedPinAttempts: 0,
      pinLockedUntil: null,
    },
  });

  return NextResponse.json({ ok: true });
}
