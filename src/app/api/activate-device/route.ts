import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activatePointDevice, hashInstallToken } from "@/lib/operator-auth";
import { isAuthRateLimited } from "@/lib/auth-rate-limit";
import { getClientIp } from "@/lib/instructions/request-ip";

export async function POST(request: Request) {
  // Единственный неавторизованный роут, который что-то ЗАПИСЫВАЕТ, и до аудита
  // 2026-08-13 он был вообще без ограничителя: префикс /api/auth/ сюда не
  // попадает, а свой лимит не ставился. Сам токен — 32 случайных байта, его не
  // перебрать, но бесплатный неограниченный поток запросов к базе с публичного
  // адреса стоит закрыть просто потому, что закрыть дёшево.
  if (isAuthRateLimited("activate-device", getClientIp(request))) {
    return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  }

  const { token } = await request.json();
  if (typeof token !== "string") {
    return NextResponse.json({ error: "token обязателен" }, { status: 400 });
  }

  const tokenHash = hashInstallToken(token);
  const device = await prisma.pointDevice.findUnique({ where: { installTokenHash: tokenHash } });

  if (!device) {
    return NextResponse.json(
      { error: "Ссылка активации недействительна" },
      { status: 400 }
    );
  }
  if (device.activated) {
    return NextResponse.json(
      { error: "Это устройство уже активировано" },
      { status: 409 }
    );
  }
  if (!device.installTokenExpiresAt || device.installTokenExpiresAt < new Date()) {
    return NextResponse.json(
      { error: "Ссылка активации устарела, запросите новую у владельца" },
      { status: 400 }
    );
  }

  // CAS вместо обычного update (аудит 2026-07-25, финальный проход) —
  // проверка device.activated выше читалась ДО этой записи; та же QR-ссылка/
  // install-токен, открытые на двух устройствах почти одновременно (двойной
  // тап, случайно открыто на двух планшетах), иначе оба проходили её на
  // одном и том же устаревшем состоянии и оба получали подписанную cookie
  // на ОДИН и тот же PointDevice — два физических устройства делили бы одну
  // привязку PWA к точке (нарушает "одна активация = одна привязка", см.
  // комментарий у PointDevice.activated в schema.prisma).
  const claimed = await prisma.pointDevice.updateMany({
    where: { id: device.id, activated: false },
    data: {
      activated: true,
      activatedAt: new Date(),
      installTokenHash: null,
      installTokenExpiresAt: null,
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Это устройство уже активировано" }, { status: 409 });
  }

  await activatePointDevice(device.id);

  return NextResponse.json({ ok: true });
}
