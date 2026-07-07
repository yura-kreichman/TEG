import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerDeviceUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getOwnerDeviceUserId();
  if (!userId) {
    return NextResponse.json({ email: null });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  return NextResponse.json({ email: user?.email ?? null });
}
