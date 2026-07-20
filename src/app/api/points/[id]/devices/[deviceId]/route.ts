import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

async function findOwnedDevice(tenantId: string, pointId: string, deviceId: string) {
  const device = await prisma.pointDevice.findUnique({
    where: { id: deviceId },
    include: { point: true },
  });
  if (!device || device.pointId !== pointId || device.point.tenantId !== tenantId) return null;
  return device;
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/points/[id]/devices/[deviceId]">
) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId, deviceId } = await ctx.params;
  const device = await findOwnedDevice(owner.tenantId, pointId, deviceId);
  if (!device) {
    return NextResponse.json({ error: "Устройство не найдено" }, { status: 404 });
  }

  const { label, roaming, hasPrinter } = await request.json();
  if (typeof label !== "string") {
    return NextResponse.json({ error: "Название устройства обязательно" }, { status: 400 });
  }

  await prisma.pointDevice.update({
    where: { id: deviceId },
    data: {
      label: label.trim() || null,
      // Роуминг переключаем и у УЖЕ активированного устройства (запрос
      // пользователя 2026-07-19: "после активации устройства я не могу уже
      // включить Роуминг" — раньше это был только флаг при создании ссылки
      // активации; реального технического ограничения нет, PointDevice.roaming
      // просто не менялся вне POST). undefined — поле не пришло в запросе
      // (например, старый клиент) — не трогаем текущее значение.
      ...(typeof roaming === "boolean" ? { roaming } : {}),
      // "Есть ли на этом устройстве принтер" (запрос пользователя 2026-07-20) —
      // ручной тумблер, автоопределения нет и быть не может (у веб-платформы
      // нет API "проверить наличие принтера").
      ...(typeof hasPrinter === "boolean" ? { hasPrinter } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/points/[id]/devices/[deviceId]">
) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId, deviceId } = await ctx.params;
  const device = await findOwnedDevice(owner.tenantId, pointId, deviceId);
  if (!device) {
    return NextResponse.json({ error: "Устройство не найдено" }, { status: 404 });
  }

  // Hard delete: a PointDevice carries no historical records of its own (results
  // submissions reference the Operator, not the device), so there's nothing to
  // orphan by removing it outright — unlike Operator, which needs a guarded delete.
  await prisma.pointDevice.delete({ where: { id: deviceId } });

  return NextResponse.json({ ok: true });
}
