import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";

// Настройки → Система (запрос пользователя 2026-07-20) — страница задумана
// расширяемой ("первый пункт там будет"). Тумблеры:
// - goodsAllowBalancePayment: разрешена ли клиентам оплата Товаров балансом
//   (docs/spec/09-goods.md, "Продажа") — глобально, на весь тенант.
// - printingEnabled: общий рубильник будущего модуля печати квитанций (не
//   фискальных чеков) — сам выбор принтера сюда не переедет, он привязан к
//   устройству/точке, не к тенанту (см. комментарий у поля в schema.prisma).
// - receiptShowLogo/receiptShowTenantName: что показывать в шапке квитанции.
// - Футер квитанции УДАЛЁН целиком (запрос пользователя 2026-07-21) —
//   реальный, так и не решённый баг: непустой футер 100% гарантированно
//   портил печать на конкретном Bluetooth ESC/POS-мосту, независимо от
//   формата текста (richtext/обычный) и длины документа — несколько раундов
//   гипотез (см. историю в src/lib/print/receipt-document.ts до этой правки)
//   ни разу не подтвердились на реальном устройстве. Решили не тратить
//   больше времени на этот конкретный принтер/мост и убрать функцию.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: {
      name: true,
      logoUrl: true,
      goodsAllowBalancePayment: true,
      printingEnabled: true,
      receiptShowLogo: true,
      receiptShowTenantName: true,
      receiptCompactHeader: true,
    },
  });

  return NextResponse.json({
    goodsAllowBalancePayment: tenant?.goodsAllowBalancePayment ?? true,
    printingEnabled: tenant?.printingEnabled ?? false,
    // Только для превью квитанции ниже на этой же странице — шапка (лого/
    // название) переиспользует уже существующие поля тенанта, отдельно не
    // редактируется здесь (запрос пользователя 2026-07-20).
    tenantName: tenant?.name ?? "",
    logoUrl: tenant?.logoUrl ?? null,
    receiptShowLogo: tenant?.receiptShowLogo ?? true,
    receiptShowTenantName: tenant?.receiptShowTenantName ?? true,
    receiptCompactHeader: tenant?.receiptCompactHeader ?? false,
  });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const data: {
    goodsAllowBalancePayment?: boolean;
    printingEnabled?: boolean;
    receiptShowLogo?: boolean;
    receiptShowTenantName?: boolean;
    receiptCompactHeader?: boolean;
  } = {};

  if (body.goodsAllowBalancePayment !== undefined) {
    if (typeof body.goodsAllowBalancePayment !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.goodsAllowBalancePayment = body.goodsAllowBalancePayment;
  }
  if (body.printingEnabled !== undefined) {
    if (typeof body.printingEnabled !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.printingEnabled = body.printingEnabled;
  }
  if (body.receiptShowLogo !== undefined) {
    if (typeof body.receiptShowLogo !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.receiptShowLogo = body.receiptShowLogo;
  }
  if (body.receiptShowTenantName !== undefined) {
    if (typeof body.receiptShowTenantName !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.receiptShowTenantName = body.receiptShowTenantName;
  }
  if (body.receiptCompactHeader !== undefined) {
    if (typeof body.receiptCompactHeader !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.receiptCompactHeader = body.receiptCompactHeader;
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  return NextResponse.json({ ok: true });
}
