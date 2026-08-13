import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hashPin } from "@/lib/auth";
import { isSessionRevoked } from "@/lib/session-revocation";
import { isPinTakenInTenant } from "@/lib/operator-auth";
import { clearFailedPins, userPinKey } from "@/lib/pin-attempts";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Требуется вход в систему" }, { status: 401 });
  }
  const userId = session.userId;

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
  // Отзыв сессий проверяется ЗДЕСЬ, а не только в requireOwner (найдено
  // вторым проходом аудита 2026-08-13, дыра в правке того же дня): этот роут
  // ходил по голому id из куки, без загрузки пользователя. То есть сессия,
  // обесцененная сменой пароля, могла назначить ПИН — и вернуть себе полный
  // вход в кабинет с этого устройства. Сброс пароля не зря обнуляет pinHash
  // (см. api/auth/reset-password): этот роут разрешал поставить его обратно.
  // Пользователь тут и так читается из базы, так что проверка бесплатна.
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true, sessionsValidFrom: true },
  });
  if (!currentUser || isSessionRevoked(session, currentUser.sessionsValidFrom)) {
    return NextResponse.json({ error: "Требуется вход в систему" }, { status: 401 });
  }
  if (currentUser.tenantId && (await isPinTakenInTenant(currentUser.tenantId, pin))) {
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
