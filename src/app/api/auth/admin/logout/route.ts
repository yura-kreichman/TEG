import { NextResponse } from "next/server";
import { destroyAdminSession, endImpersonation, getImpersonatingAdminId } from "@/lib/auth";

export async function POST() {
  // Логаут админа обязан завершить и активную имперсонацию — иначе
  // имперсонированная Owner-сессия (свой независимый 2-часовой таймер,
  // см. startImpersonation) продолжает работать после того, как админ
  // явно вышел из /admin (реальная дыра, найдена аудитом 2026-07-24).
  if (await getImpersonatingAdminId()) {
    await endImpersonation();
  }
  await destroyAdminSession();
  return NextResponse.json({ ok: true });
}
