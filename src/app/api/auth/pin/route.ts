import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId, hashPin } from "@/lib/auth";
import { isPinTakenInTenant } from "@/lib/operator-auth";
import { clearFailedPins, userPinKey } from "@/lib/pin-attempts";

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

  // Обратная сторона проверки в api/operators (см. isOwnerPinInTenant там) —
  // Владелец тоже не должен случайно взять себе ПИН, который уже выдан
  // какому-то оператору (запрос пользователя 2026-07-29: "или наоборот, если
  // владелец решит поменять"). tenantId у Owner всегда заполнен (см. схему).
  const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
  if (currentUser?.tenantId && (await isPinTakenInTenant(currentUser.tenantId, pin))) {
    return NextResponse.json(
      { error: "Этот ПИН-код уже занят одним из операторов, выберите другой" },
      { status: 409 }
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

  // Новый ПИН — старые промахи не в счёт: иначе владелец, сменивший ПИН именно
  // потому, что путался в прежнем, унёс бы предел с собой.
  clearFailedPins(userPinKey(userId));

  return NextResponse.json({ ok: true });
}
