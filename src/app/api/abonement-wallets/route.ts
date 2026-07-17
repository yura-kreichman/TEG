import { NextResponse } from "next/server";
import { requireOwner, findTenantPoint } from "@/lib/require-owner";
import {
  ABONEMENT_TOPUP_PAYMENT_METHODS,
  createWalletWithAdjustment,
  createWalletWithTopup,
  findWalletByPhone,
  normalizePhone,
} from "@/lib/abonement";

// Продажа/пополнение абонемента ВЛАДЕЛЬЦЕМ, не только оператором (запрос
// пользователя 2026-07-17: "это может делать как Владелец, так и Сотрудник")
// — аналог /api/operator/abonements, но owner-сессия не привязана к одной
// точке устройства, поэтому точку владелец указывает явно в теле запроса
// (проверяется, что она принадлежит его тенанту).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone") ?? "";
  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  const wallet = await findWalletByPhone(owner.tenantId, phone);
  if (!wallet) {
    return NextResponse.json({ abonement: null });
  }
  return NextResponse.json({
    abonement: { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) },
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const phone: string = typeof body.phone === "string" ? body.phone : "";
  const name: string | null = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const abonementId: string | null = typeof body.abonementId === "string" && body.abonementId ? body.abonementId : null;
  // Произвольная сумма — ТОЛЬКО владелец (запрос пользователя 2026-07-17:
  // "это родственник владельца или его друг, хочет кинуть на абонемент
  // произвольную сумму"), минуя выбор абонемента/способа оплаты — но
  // трактуется как наличный расчёт (уточнение того же дня: "как бы из его
  // денег") и трогает кассу выбранной точки ровно как обычное пополнение
  // наличными, см. createWalletWithAdjustment. У оператора этой ветки нет
  // вообще — /api/operator/abonements не принимает amount.
  const amount: number | null = body.amount != null ? Number(body.amount) : null;
  const pointId: string | null = typeof body.pointId === "string" && body.pointId ? body.pointId : null;
  const paymentMethod = body.paymentMethod;

  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  const existing = await findWalletByPhone(owner.tenantId, phone);
  if (existing) {
    return NextResponse.json({ error: "Абонемент с этим номером уже существует" }, { status: 400 });
  }

  if (amount != null) {
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
    }
    if (!pointId || !(await findTenantPoint(owner.tenantId, pointId))) {
      return NextResponse.json({ error: "Выберите точку" }, { status: 400 });
    }
    const wallet = await createWalletWithAdjustment(phone, name, owner.tenantId, pointId, amount, owner.user.id);
    return NextResponse.json(
      { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) },
      { status: 201 }
    );
  }

  if (!abonementId) {
    return NextResponse.json({ error: "Выберите абонемент" }, { status: 400 });
  }
  if (!pointId || !(await findTenantPoint(owner.tenantId, pointId))) {
    return NextResponse.json({ error: "Выберите точку" }, { status: 400 });
  }
  if (!(ABONEMENT_TOPUP_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return NextResponse.json({ error: "Выберите способ оплаты" }, { status: 400 });
  }

  try {
    const wallet = await createWalletWithTopup(phone, name, {
      tenantId: owner.tenantId,
      pointId,
      abonementId,
      paymentMethod,
      actor: { userId: owner.user.id },
    });
    return NextResponse.json(
      { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "ABONEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "Абонемент не найден" }, { status: 400 });
    }
    throw err;
  }
}
