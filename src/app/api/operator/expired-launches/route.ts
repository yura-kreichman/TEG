import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { findExpiredFixedLaunches } from "@/lib/game-room";

// Глобальное напоминание о просроченных пусках "За вход" (запрос
// пользователя 2026-07-17: "не хватает напоминания... если ПОДОШЁЛ ТАЙМЕР К
// КОНЦУ") — опрашивается из OperatorBottomNav на любом экране PWA, не только
// на "Прибываниях", по всей точке оператора разом.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const result = await findExpiredFixedLaunches(point.id, operator);
  return NextResponse.json(result);
}
