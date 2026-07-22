import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { createWalletEmpty, createWalletWithAdjustment, findWalletByPhone, normalizePhone } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Регистрация клиента и произвольное пополнение ВЛАДЕЛЬЦЕМ (запрос
// пользователя 2026-07-17: "это родственник владельца или его друг... кинуть
// на абонемент произвольную сумму"). Продажа плана (Наличные/Безнал, кассовая
// операция) владельцу НЕ доступна (запрос пользователя 2026-07-18: "Продаёт
// только сотрудник" — см. /api/operator/abonements) — Владелец физически не
// стоит на точке и не берёт реальные деньги.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
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
    abonement: {
      id: wallet.id,
      phone: wallet.phone,
      name: wallet.name,
      balance: Number(wallet.balance),
      createdAt: wallet.createdAt,
    },
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const phone: string = typeof body.phone === "string" ? body.phone : "";
  const name: string | null = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  // Произвольная сумма — не кассовая операция, без точки (запрос
  // пользователя 2026-07-18: "нигде не должно учитываться"), см.
  // createWalletWithAdjustment.
  const amount: number | null = body.amount != null ? Number(body.amount) : null;

  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  const existing = await findWalletByPhone(owner.tenantId, phone);
  if (existing) {
    return NextResponse.json({ error: "Абонемент с этим номером уже существует" }, { status: 400 });
  }

  // Без суммы — просто регистрация нового клиента, без пополнения (запрос
  // пользователя 2026-07-18: "чтобы сотрудник мог завести нового абонента, но
  // не продавать сам абонимент... может человек потом захочет").
  if (amount == null) {
    const wallet = await createWalletEmpty(phone, name, owner.tenantId);
    return NextResponse.json(
      { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance), createdAt: wallet.createdAt },
      { status: 201 }
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Укажите сумму" }, { status: 400 });
  }
  const wallet = await createWalletWithAdjustment(phone, name, owner.tenantId, amount, owner.user.id);
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
}
