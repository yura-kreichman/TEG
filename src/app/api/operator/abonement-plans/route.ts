import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { listAbonements } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Список абонементов (планов) тенанта — экран оплаты "Прибываний"/"Пусков" и
// пополнение существующего кошелька (запрос пользователя 2026-07-17). Только
// чтение — создают/редактируют абонементы только владельцы, см.
// /api/abonements. Планы всегда видны на всех точках тенанта (запрос
// пользователя 2026-07-18: "просто зачисляется клиенту" — без ограничения по
// точкам).
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = ctx;
  if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const plans = await listAbonements(point.tenantId);
  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      creditAmount: Number(p.creditAmount),
    })),
  });
}
