import { NextResponse } from "next/server";
import { forgetOwnerDevice } from "@/lib/auth";

export async function POST() {
  await forgetOwnerDevice();
  return NextResponse.json({ ok: true });
}
