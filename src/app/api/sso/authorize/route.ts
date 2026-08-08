import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { SSO_CODE_TTL_MS, generateSsoCode, isAllowedRedirectUri } from "@/lib/sso";

/**
 * Шаг 1 единого входа: браузер приходит сюда с сайта по кнопке "Войти через
 * RentOS", здесь подтверждается, что это владелец, и браузер уезжает обратно с
 * одноразовым кодом (решение пользователя 2026-08-08).
 *
 * Владельца НЕ авторизуем заново, если он уже вошёл в кабинет — в этом и смысл
 * единого входа: один пароль, введённый один раз.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  // Состояние сайта (нонс CSRF на его стороне) — возвращаем как пришло, не
  // читая: нам оно не нужно, а WordPress по нему проверяет, что ответ отвечает
  // на его же запрос.
  const state = searchParams.get("state");

  // Проверяем адрес возврата ДО всего остального: пока он не в белом списке,
  // никакого кода не существует и уводить браузер некуда.
  if (!isAllowedRedirectUri(redirectUri)) {
    return NextResponse.json({ error: "redirect_uri не разрешён" }, { status: 400 });
  }

  const owner = await requireOwner();
  if (!owner) {
    // Отправляем на вход и возвращаем ровно сюда же — со всеми исходными
    // параметрами, чтобы после входа человек не оказался в кабинете вместо
    // того, куда шёл.
    const back = new URL(request.url);
    const login = new URL("/login", back.origin);
    login.searchParams.set("next", `${back.pathname}${back.search}`);
    return NextResponse.redirect(login);
  }

  const { code, codeHash } = generateSsoCode();
  await prisma.ssoCode.create({
    data: {
      codeHash,
      userId: owner.user.id,
      redirectUri,
      expiresAt: new Date(Date.now() + SSO_CODE_TTL_MS),
    },
  });

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);
  return NextResponse.redirect(target);
}
