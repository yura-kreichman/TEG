import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { activatePointDevice } from "@/lib/operator-auth";

// Альтернатива обычному созданию устройства (POST /api/points/[id]/devices,
// ссылка/QR + активация ПОТОМ на самом устройстве) — для случая, когда
// Владелец прямо сейчас физически сидит за этим браузером/планшетом
// (запрос пользователя 2026-07-29: "чтобы когда владелец зашёл на
// устройстве он мог его привязать в своём интерфейсе", явно "не менять то,
// что уже сделали" — ссылка/QR-флоу не тронут, это чисто добавочный путь).
// installToken тут не нужен вовсе — сам факт владельческой сессии уже
// доказывает право создавать устройства на этой точке (Владелец и так может
// сгенерировать ссылку активации без ограничений), поэтому устройство сразу
// создаётся activated:true и activatePointDevice ставит operator-device
// cookie НА ЭТОТ ЖЕ ответ — то есть на браузер, которым Владелец только что
// нажал кнопку.
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/devices/bind-current">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { label, roaming, hasPrinter, receiptPaperWidth } = await request.json().catch(() => ({
    label: undefined,
    roaming: undefined,
    hasPrinter: undefined,
    receiptPaperWidth: undefined,
  }));

  if (receiptPaperWidth !== undefined && !["58", "80", "a4"].includes(receiptPaperWidth)) {
    return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
  }

  const device = await prisma.pointDevice.create({
    data: {
      pointId,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      roaming: roaming === true,
      hasPrinter: hasPrinter === true,
      ...(receiptPaperWidth !== undefined ? { receiptPaperWidth } : {}),
      activated: true,
      activatedAt: new Date(),
    },
  });

  await activatePointDevice(device.id);

  return NextResponse.json({ id: device.id }, { status: 201 });
}
