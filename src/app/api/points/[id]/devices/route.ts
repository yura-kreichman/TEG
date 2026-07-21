import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { INSTALL_TOKEN_TTL_MS, generateInstallToken } from "@/lib/operator-auth";
import { getRequestOrigin } from "@/lib/request-origin";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/points/[id]/devices">
) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { label, roaming, hasPrinter } = await request.json().catch(() => ({ label: undefined, roaming: undefined, hasPrinter: undefined }));

  const { token, tokenHash } = generateInstallToken();
  const device = await prisma.pointDevice.create({
    data: {
      pointId,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      roaming: roaming === true,
      hasPrinter: hasPrinter === true,
      installTokenHash: tokenHash,
      installTokenExpiresAt: new Date(Date.now() + INSTALL_TOKEN_TTL_MS),
    },
  });

  const installLink = `${getRequestOrigin(request)}/activate-device?token=${token}`;

  return NextResponse.json({ id: device.id, installLink }, { status: 201 });
}
