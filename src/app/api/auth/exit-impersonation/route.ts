import { NextResponse } from "next/server";
import { endImpersonation } from "@/lib/auth";

export async function POST() {
  await endImpersonation();
  return NextResponse.json({ ok: true });
}
