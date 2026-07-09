import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { defaultShiftStartTime: true },
  });

  return NextResponse.json({ defaultShiftStartTime: tenant?.defaultShiftStartTime ?? "10:00" });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { defaultShiftStartTime } = await request.json();
  if (typeof defaultShiftStartTime !== "string" || !TIME_RE.test(defaultShiftStartTime)) {
    return NextResponse.json({ error: "Некорректное время (ожидается ЧЧ:ММ)" }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data: { defaultShiftStartTime } });
  return NextResponse.json({ ok: true });
}
