import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Used by the Docker healthcheck and Nginx upstream check — confirms the
// process is up and can actually reach Postgres, not just that Next.js booted.
export async function GET() {
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({ ok: true });
}
