import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import { listAbonements } from "@/lib/abonement";

// Список абонементов (планов), видимых оператору в его точке — экран оплаты
// "Прибываний"/"Пусков" и пополнение существующего кошелька (запрос
// пользователя 2026-07-17). Только чтение — создают/редактируют абонементы
// только владельцы, см. /api/abonements. Абонемент без точек виден везде
// (запрос пользователя того же дня: "выбор действует ли он на все точки
// клиента или нет"), с точками — только там.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = ctx;

  const plans = await listAbonements(point.tenantId, point.id);
  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      creditAmount: Number(p.creditAmount),
    })),
  });
}
