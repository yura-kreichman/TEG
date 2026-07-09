import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword, rememberOwnerDevice } from "@/lib/auth";
import { setAccentCookie } from "@/lib/accent";
import { verifyCaptchaAnswer } from "@/lib/captcha";
import { resolveLocale } from "@/lib/i18n";

// Packages are meant to be managed from the (not-yet-built) Super Admin module,
// but registration needs *some* package to assign a new tenant to. Until that
// admin UI exists, fall back to a single default "Starter" package, created here
// on first use rather than via a seed script.
async function getDefaultPackage() {
  const existing = await prisma.package.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  return prisma.package.create({
    data: {
      name: "Starter",
      modules: ["counters", "money"],
      maxPoints: 5,
      maxZones: 10,
      maxAssets: 50,
      maxOperators: 10,
      priceMonthly: 0,
    },
  });
}

export async function POST(request: Request) {
  const { email, password, tenantName, captchaToken, captchaAnswer } = await request.json();

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

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName.trim(),
      packageId: pkg.id,
      locale,
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

  await createSession(user.id);
  await rememberOwnerDevice(user.id);
  await setAccentCookie(tenant.accentScheme);

  return NextResponse.json(
    { id: user.id, email: user.email, tenantId: tenant.id },
    { status: 201 }
  );
}
