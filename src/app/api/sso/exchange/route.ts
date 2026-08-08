import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSsoCode } from "@/lib/sso";
import { timingSafeEqualStrings } from "@/lib/timing-safe-equal";

/**
 * Шаг 2 единого входа: WordPress обменивает одноразовый код на подтверждённые
 * данные владельца. Вызывается сервер-сервер, не из браузера — поэтому общий
 * секрет, а не сессия.
 *
 * Отдаём МИНИМУМ, нужный чтобы найти или создать WP-пользователя: email, имя
 * тенанта и идентификатор покупателя FluentCart. Ни пароля, ни PIN-ов, ни
 * состава тенанта — WordPress о них знать не должен.
 */
const SECRET_HEADER = "x-rentos-sso-secret";

export async function POST(request: Request) {
  const secret = process.env.SSO_SHARED_SECRET;
  const provided = request.headers.get(SECRET_HEADER);
  // Пустая переменная = единый вход выключен, а не "секрет не требуется".
  if (!secret || !provided || !timingSafeEqualStrings(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const code = (body as { code?: unknown })?.code;
  if (typeof code !== "string" || !code) {
    return NextResponse.json({ error: "code обязателен" }, { status: 400 });
  }

  // Гасим и читаем одной операцией: updateMany с условием "ещё не погашен и не
  // истёк" — если параллельный запрос успел раньше, он изменит 0 строк и
  // получит отказ. Проверка-затем-запись оставляла бы окно на повторный вход по
  // одному коду.
  const codeHash = hashSsoCode(code);
  const burned = await prisma.ssoCode.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (burned.count === 0) {
    return NextResponse.json({ error: "Код недействителен, использован или истёк" }, { status: 400 });
  }

  const row = await prisma.ssoCode.findUnique({
    where: { codeHash },
    include: {
      user: {
        select: {
          email: true,
          tenant: {
            select: { name: true, fluentcartCustomerId: true, subscriptionStatus: true },
          },
        },
      },
    },
  });
  if (!row?.user.tenant) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 400 });
  }

  return NextResponse.json({
    email: row.user.email,
    tenantName: row.user.tenant.name,
    fluentcartCustomerId: row.user.tenant.fluentcartCustomerId,
    subscriptionStatus: row.user.tenant.subscriptionStatus,
    // Тот адрес, под который код выдавался — сайт сверяет со своим, чтобы код,
    // выданный для одной страницы, нельзя было предъявить от имени другой.
    redirectUri: row.redirectUri,
  });
}
