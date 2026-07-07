import { NextResponse } from "next/server";
import { destroyOperatorSession } from "@/lib/operator-auth";

// Only clears the operator's PIN session, not the point_device cookie — the
// device stays activated so the next operator can enter their own PIN.
export async function POST() {
  await destroyOperatorSession();
  return NextResponse.json({ ok: true });
}
