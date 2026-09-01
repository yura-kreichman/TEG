import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import {
  createWalletEmpty,
  createWalletWithAdjustment,
  findWalletByPhone,
  isCreatableClientPhone,
  searchWallets,
  serializeCandidate,
} from "@/lib/abonement";
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
  // q — номер целиком, хвост от 4 цифр или имя (запрос пользователя
  // 2026-09-01); phone — прежнее имя параметра, оставлено синонимом.
  const query = searchParams.get("q") ?? searchParams.get("phone") ?? "";
  const result = await searchWallets(owner.tenantId, query);
  if (result.kind === "empty") {
    return NextResponse.json({ error: "Введите номер телефона или имя" }, { status: 400 });
  }
  if (result.kind === "tooShort") {
    return NextResponse.json({ error: "Введите минимум 4 цифры номера или имя" }, { status: 400 });
  }

  const wallet = result.exact;
  if (!wallet) {
    // Кандидаты вместо точного совпадения — тот же приём, что у сотрудника
    // (реальный баг с прода 2026-08-13). Список кошельков владельца ищет по
    // вхождению подстроки и короткий номер находил и так, но ЭТОТ путь —
    // точечный поиск по номеру — оставался строгим.
    return NextResponse.json({
      abonement: null,
      kind: result.kind,
      truncated: result.truncated,
      similar: result.candidates.map((c) => serializeCandidate(c, result.kind === "phone")),
    });
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

  // Новый кошелёк — только по полному номеру (см. PHONE_CREATE_MIN_DIGITS):
  // строка поиска теперь может быть хвостом номера или именем.
  if (!isCreatableClientPhone(phone)) {
    return NextResponse.json({ error: "Для нового клиента введите номер целиком" }, { status: 400 });
  }

  const existing = await findWalletByPhone(owner.tenantId, phone);
  if (existing) {
    return NextResponse.json({ error: "Абонемент с этим номером уже существует" }, { status: 400 });
  }

  // Без суммы — просто регистрация нового клиента, без пополнения (запрос
  // пользователя 2026-07-18: "чтобы сотрудник мог завести нового абонента, но
  // не продавать сам абонимент... может человек потом захочет").
  try {
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
  } catch (err) {
    // Гонка "два почти одновременных создания на один и тот же новый номер"
    // (аудит 2026-07-25, финальный проход) — findWalletByPhone выше не
    // защищает от неё сама по себе (check-then-create), но
    // @@unique([tenantId, phone]) в схеме гарантированно ловит дубль на
    // уровне БД; здесь превращаем голый P2002/500 в тот же дружелюбный текст,
    // что уже возвращает предварительная проверка.
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Абонемент с этим номером уже существует" }, { status: 400 });
    }
    throw err;
  }
}
