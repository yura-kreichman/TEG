import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword, rememberOwnerDevice } from "@/lib/auth";
import { setAccentCookie } from "@/lib/accent";
import { verifyCaptchaAnswer } from "@/lib/captcha";
import { resolveLocale } from "@/lib/i18n";
import { linkPendingFluentCartPurchases } from "@/lib/fluentcart-webhook";
import { generateUniqueSlug } from "@/lib/instructions/slug";

// Новый тенант при регистрации всегда получает бесплатный пакет (пакеты
// теперь управляются из Super Admin, docs/spec/06-super-admin.md) —
// определяется по priceMonthly=0, а не "первый созданный" (то была ошибка:
// Starter уже не самый старый пакет в реальных данных). fluentcartProductId
// у Free намеренно не привязан — этот пакет никогда не покупается через
// FluentCart. Фолбэк на создание — только если в свежей инсталляции вообще
// нет ни одного пакета.
async function getDefaultPackage() {
  const existing = await prisma.package.findFirst({ where: { priceMonthly: 0 } });
  if (existing) return existing;

  return prisma.package.create({
    data: {
      name: "Free",
      maxPoints: 1,
      maxZones: 2,
      maxAssets: 10,
      maxOperators: 3,
      priceMonthly: 0,
    },
  });
}

// Бесплатный период ограничен по времени (доп. решение пользователя
// 2026-07-12) — summary-scheduler.ts уже переводит active в expired, когда
// subscriptionExpiresAt проходит (этот механизм существовал и раньше для
// ручных корректировок Super Admin'ом, просто ничего не выставляло его при
// регистрации). Реальная оплата через FluentCart сбрасывает это поле в null
// (см. syncTenantFromFluentCartEvent) — источником правды об окончании
// становится сам биллинг, а не эта разовая метка.
const FREE_TRIAL_DAYS = 30;

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export async function POST(request: Request) {
  const { email, password, tenantName, captchaToken, captchaAnswer, timezone } = await request.json();

  if (!verifyCaptchaAnswer(captchaToken, captchaAnswer)) {
    return NextResponse.json({ error: "Неверный ответ на проверочный вопрос", captchaFailed: true }, { status: 400 });
  }

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "email и password обязательны" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Пароль должен быть не короче 8 символов" },
      { status: 400 }
    );
  }
  if (typeof tenantName !== "string" || tenantName.trim().length === 0) {
    return NextResponse.json(
      { error: "Название компании обязательно" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Пользователь с таким email уже существует" },
      { status: 409 }
    );
  }

  const pkg = await getDefaultPackage();
  const locale = await resolveLocale();
  // Для публичной ссылки модуля Инструктажи (docs/spec/07-instructions.md,
  // "Tenant.slug") — единственный публичный потребитель этого поля.
  const slug = await generateUniqueSlug(tenantName.trim(), async (candidate) => {
    const conflict = await prisma.tenant.findUnique({ where: { slug: candidate } });
    return !!conflict;
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName.trim(),
      slug,
      packageId: pkg.id,
      locale,
      subscriptionExpiresAt: new Date(Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000),
      // Часовой пояс браузера при регистрации (docs/spec/00-architecture.md) —
      // разумный дефолт вместо "UTC" вместо всегда-неверного значения по
      // умолчанию; невалидное/отсутствующее значение молча игнорируется,
      // схемный default "UTC" остаётся страховкой.
      ...(typeof timezone === "string" && VALID_TIMEZONES.has(timezone) ? { timezone } : {}),
    },
  });

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: "owner",
      tenantId: tenant.id,
    },
  });

  // Клиент мог купить подписку в FluentCart раньше, чем зарегистрировался в
  // RentOS (доп. решение пользователя 2026-07-12) — подхватывает такую
  // покупку сразу же, вместо бесплатного пакета выше. См. комментарий у
  // linkPendingFluentCartPurchases в fluentcart-webhook.ts.
  await linkPendingFluentCartPurchases(email);

  await createSession(user.id);
  await rememberOwnerDevice(user.id);
  await setAccentCookie(tenant.accentScheme);

  return NextResponse.json(
    { id: user.id, email: user.email, tenantId: tenant.id },
    { status: 201 }
  );
}
