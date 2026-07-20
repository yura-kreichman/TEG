import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { validateRichContent, extractPlainText, isRichContentEmpty } from "@/lib/rich-text";

// Настройки → Система (запрос пользователя 2026-07-20) — страница задумана
// расширяемой ("первый пункт там будет"). Тумблеры:
// - goodsAllowBalancePayment: разрешена ли клиентам оплата Товаров балансом
//   (docs/spec/09-goods.md, "Продажа") — глобально, на весь тенант.
// - printingEnabled: общий рубильник будущего модуля печати квитанций (не
//   фискальных чеков) — сам выбор принтера сюда не переедет, он привязан к
//   устройству/точке, не к тенанту (см. комментарий у поля в schema.prisma).
// - receiptFooterContent: rich text (тот же формат/редактор, что у Лендинга/
//   Инструктажей, запрос пользователя 2026-07-20), не голый текст.
// - receiptShowLogo/receiptShowTenantName: что показывать в шапке квитанции.
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
      receiptFooterContent: true,
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
    receiptFooterContent: tenant?.receiptFooterContent ?? null,
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
    receiptFooterContent?: Prisma.InputJsonValue | typeof Prisma.DbNull;
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
  if (body.receiptFooterContent !== undefined) {
    if (body.receiptFooterContent === null) {
      data.receiptFooterContent = Prisma.DbNull;
    } else {
      if (!validateRichContent(body.receiptFooterContent)) {
        return NextResponse.json({ error: "Некорректный формат текста" }, { status: 400 });
      }
      if (extractPlainText(body.receiptFooterContent).length > 1000) {
        return NextResponse.json({ error: "Слишком длинный текст" }, { status: 400 });
      }
      data.receiptFooterContent = isRichContentEmpty(body.receiptFooterContent)
        ? Prisma.DbNull
        : (body.receiptFooterContent as unknown as Prisma.InputJsonValue);
    }
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
