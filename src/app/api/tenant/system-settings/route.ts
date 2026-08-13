import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidateTenantModuleFlags } from "@/lib/tenant-modules";
import { requireOwner } from "@/lib/require-owner";
import { BG_EFFECT_VALUES } from "@/components/bg-effects";
import { normalizeBgEffect } from "@/components/bg-effects/shared";
import { isSelfServicePayoutMode } from "@/lib/work-time";
import { extractPlainText, isRichContentEmpty, validateRichContent } from "@/lib/rich-text";

import { Prisma } from "@/generated/prisma/client";

// Подвал квитанции — несколько строк, а не документ (в отличие от инструктажа).
const MAX_RECEIPT_FOOTER_LENGTH = 2000;

// Настройки → Система (запрос пользователя 2026-07-20) — страница задумана
// расширяемой ("первый пункт там будет"). Тумблеры:
// - goodsAllowBalancePayment: разрешена ли клиентам оплата Товаров балансом
//   (docs/spec/09-goods.md, "Продажа") — глобально, на весь тенант.
// - printingEnabled: общий рубильник будущего модуля печати квитанций (не
//   фискальных чеков) — сам выбор принтера сюда не переедет, он привязан к
//   устройству/точке, не к тенанту (см. комментарий у поля в schema.prisma).
// - receiptShowLogo/receiptShowTenantName: что показывать в шапке квитанции.
// - receiptFooterContent: подвал квитанции, richtext. ВОЗВРАЩЁН 2026-08-12
//   после того, как был удалён целиком 2026-07-21 — тогда любой непустой
//   подвал ломал печать на Bluetooth ESC/POS-мосту, и четыре круга гипотез
//   реальное железо опровергло. Настоящая причина ТЕХ поломок нашлась
//   2026-07-25 и к подвалу отношения не имела (преждевременный afterprint на
//   Android стирал содержимое посреди задания). Полная история и условия
//   отката — у поля Tenant.receiptFooterContent в prisma/schema.prisma.
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
      expensesEnabled: true,
      selfServicePayoutMode: true,
      bgEffect: true,
      receiptShowLogo: true,
      receiptShowTenantName: true,
      receiptCompactHeader: true,
      receiptFooterContent: true,
      instructionsEnabled: true,
      tasksEnabled: true,
      landingEnabled: true,
      goodsEnabled: true,
      clientsEnabled: true,
    },
  });

  return NextResponse.json({
    goodsAllowBalancePayment: tenant?.goodsAllowBalancePayment ?? true,
    printingEnabled: tenant?.printingEnabled ?? false,
    expensesEnabled: tenant?.expensesEnabled ?? true,
    // Что Сотрудник вносит сам при завершении смены — режим из трёх, а не
    // тумблер (запрос пользователя 2026-08-12): "cash" | "forbidden" |
    // "accrual", см. комментарий у поля в schema.prisma.
    selfServicePayoutMode: isSelfServicePayoutMode(tenant?.selfServicePayoutMode)
      ? tenant.selfServicePayoutMode
      : "cash",
    // normalizeBgEffect — старое сохранённое "sparkles" (удалённый эффект
    // "Искры", заменён "Гиперпространством" 2026-07-28) трактуется как
    // "hyperspace" при чтении; перезапишется настоящим значением при
    // следующем сохранении через PATCH ниже.
    bgEffect: normalizeBgEffect(tenant?.bgEffect),
    // Только для превью квитанции ниже на этой же странице — шапка (лого/
    // название) переиспользует уже существующие поля тенанта, отдельно не
    // редактируется здесь (запрос пользователя 2026-07-20).
    tenantName: tenant?.name ?? "",
    logoUrl: tenant?.logoUrl ?? null,
    receiptShowLogo: tenant?.receiptShowLogo ?? true,
    receiptShowTenantName: tenant?.receiptShowTenantName ?? true,
    receiptCompactHeader: tenant?.receiptCompactHeader ?? false,
    // Подвал квитанции (возвращён 2026-08-12) — null у тех, кто не заполнял.
    receiptFooterContent: tenant?.receiptFooterContent ?? null,
    // Плашка "Модули" (запрос пользователя 2026-07-22) — первая на странице,
    // множественный выбор, см. schema.prisma у Tenant для полного объяснения
    // каждого поля.
    instructionsEnabled: tenant?.instructionsEnabled ?? true,
    tasksEnabled: tenant?.tasksEnabled ?? true,
    landingEnabled: tenant?.landingEnabled ?? true,
    goodsEnabled: tenant?.goodsEnabled ?? true,
    clientsEnabled: tenant?.clientsEnabled ?? true,
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
    expensesEnabled?: boolean;
    selfServicePayoutMode?: string;
    bgEffect?: string;
    receiptShowLogo?: boolean;
    receiptShowTenantName?: boolean;
    receiptCompactHeader?: boolean;
    receiptFooterContent?: Prisma.InputJsonValue | typeof Prisma.DbNull;
    instructionsEnabled?: boolean;
    tasksEnabled?: boolean;
    landingEnabled?: boolean;
    goodsEnabled?: boolean;
    clientsEnabled?: boolean;
  } = {};

  // Все поля этого роута — плоские boolean-тумблеры, один и тот же
  // валидируй-и-скопируй паттерн; цикл вместо повторяющихся if-блоков подряд
  // (плашка "Модули" добавила ещё 5 к уже существующим 5).
  const BOOLEAN_FIELDS = [
    "goodsAllowBalancePayment",
    "printingEnabled",
    "expensesEnabled",
    "receiptShowLogo",
    "receiptShowTenantName",
    "receiptCompactHeader",
    "instructionsEnabled",
    "tasksEnabled",
    "landingEnabled",
    "goodsEnabled",
    "clientsEnabled",
  ] as const;
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data[field] = body[field];
  }

  // selfServicePayoutMode — как и bgEffect ниже, строка из фиксированного
  // набора, поэтому мимо цикла булевых полей выше.
  if (body.selfServicePayoutMode !== undefined) {
    if (!isSelfServicePayoutMode(body.selfServicePayoutMode)) {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.selfServicePayoutMode = body.selfServicePayoutMode;
  }

  // Подвал квитанции — richtext, валидируется тем же белым списком узлов и
  // марок, что Инструктажи и Лендинг. null приходит от кнопки "очистить":
  // Prisma.DbNull, а не JS null — иначе Prisma поймёт это как JSON-значение
  // null внутри колонки, а не как "поле пустое".
  if (body.receiptFooterContent !== undefined) {
    if (body.receiptFooterContent === null) {
      data.receiptFooterContent = Prisma.DbNull;
    } else if (validateRichContent(body.receiptFooterContent)) {
      // Предел длины (аудит 2026-08-13) — у инструктажей он был с самого
      // начала (MAX_INSTRUCTION_CONTENT_LENGTH), а у подвала не появился:
      // белый список узлов ограничивает ФОРМУ содержимого, но не его объём,
      // и в JSONB-колонку можно было положить мегабайты, которые потом
      // читаются на каждую печать квитанции. Подвал чека — это несколько
      // строк «спасибо за визит», 2000 символов с запасом перекрывают любой
      // осмысленный текст.
      if (extractPlainText(body.receiptFooterContent).length > MAX_RECEIPT_FOOTER_LENGTH) {
        return NextResponse.json(
          { error: `Подвал квитанции длиннее ${MAX_RECEIPT_FOOTER_LENGTH} символов` },
          { status: 400 }
        );
      }
      data.receiptFooterContent = isRichContentEmpty(body.receiptFooterContent)
        ? Prisma.DbNull
        : (body.receiptFooterContent as Prisma.InputJsonValue);
    } else {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
  }

  // bgEffect — строка из фиксированного набора (не boolean), свой отдельный
  // if вместо цикла выше (запрос пользователя 2026-07-27: "Волны" выросли в
  // выбор одного эффекта из нескольких, тот же принцип, что bgStyle).
  if (body.bgEffect !== undefined) {
    if (typeof body.bgEffect !== "string" || !BG_EFFECT_VALUES.includes(body.bgEffect)) {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.bgEffect = body.bgEffect;
  }

  await prisma.tenant.update({ where: { id: owner.tenantId }, data });
  // Сброс кэша флагов модулей (аудит производительности 2026-08-13) — они
  // читаются из памяти с TTL 30 с, и без явного сброса тумблер модуля
  // применялся бы с задержкой до полуминуты. См. lib/short-cache.ts.
  invalidateTenantModuleFlags(owner.tenantId);
  return NextResponse.json({ ok: true });
}
