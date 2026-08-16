import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { buildOperatorGuide } from "@/lib/operator-guide";

// Состав памятки «Как работать» для ТЕКУЩЕГО сотрудника на ТЕКУЩЕМ
// устройстве (решение владельца 2026-08-16). Тексты сюда не попадают —
// только какие блоки показать и что в них подставить, см. lib/operator-guide.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const guide = await buildOperatorGuide({
    operator: ctx.operator,
    point: ctx.point,
    // Принтер — свойство конкретного устройства точки, а не тенанта: на
    // планшете с принтером блок про печать нужен, на телефоне рядом — нет.
    deviceHasPrinter: ctx.device.hasPrinter,
  });

  return NextResponse.json(guide);
}
