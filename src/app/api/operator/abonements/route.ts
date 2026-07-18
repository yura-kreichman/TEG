import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/require-operator";
import {
  ABONEMENT_TOPUP_PAYMENT_METHODS,
  createWalletEmpty,
  createWalletWithTopup,
  findWalletByPhone,
  normalizePhone,
} from "@/lib/abonement";

// Поиск кошелька по телефону — экран оплаты "Прибываний"/"Пусков" (запрос
// пользователя 2026-07-17). Не найден — не ошибка, просто null, дальше
// оператор может создать новый прямо тут (POST ниже).
export async function GET(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = ctx;

  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone") ?? "";
  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  const wallet = await findWalletByPhone(point.tenantId, phone);
  if (!wallet) {
    return NextResponse.json({ abonement: null });
  }
  return NextResponse.json({
    abonement: {
      id: wallet.id,
      phone: wallet.phone,
      name: wallet.name,
      balance: Number(wallet.balance),
      createdAt: wallet.createdAt,
    },
  });
}

// Первое пополнение по ещё не существующему номеру — создаёт кошелёк и
// списывает выбранный абонемент (план) сразу одной операцией (запрос
// пользователя 2026-07-17: "оператор, прямо в момент оплаты").
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const body = await request.json().catch(() => ({}));
  const phone: string = typeof body.phone === "string" ? body.phone : "";
  const name: string | null = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const abonementId: string | null = typeof body.abonementId === "string" && body.abonementId ? body.abonementId : null;
  const paymentMethod = body.paymentMethod;

  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  const existing = await findWalletByPhone(point.tenantId, phone);
  if (existing) {
    return NextResponse.json({ error: "Абонемент с этим номером уже существует" }, { status: 400 });
  }

  // Без выбранного плана — просто регистрация нового абонента, без покупки
  // (запрос пользователя 2026-07-18: "может человек потом захочет").
  if (!abonementId) {
    const wallet = await createWalletEmpty(phone, name, point.tenantId);
    return NextResponse.json(
      { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance), createdAt: wallet.createdAt },
      { status: 201 }
    );
  }
  if (!(ABONEMENT_TOPUP_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
  }

  try {
    const wallet = await createWalletWithTopup(phone, name, {
      tenantId: point.tenantId,
      pointId: point.id,
      abonementId,
      paymentMethod,
      actor: { operatorId: operator.id },
    });
    return NextResponse.json(
      {
        id: wallet.id,
        phone: wallet.phone,
        name: wallet.name,
        balance: Number(wallet.balance),
        createdAt: wallet.createdAt,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "ABONEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Абонемент не найден" }, { status: 400 });
    }
    throw err;
  }
}
