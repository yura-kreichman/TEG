import { getDictionary, type Dictionary } from "@/lib/i18n";
import { isLocale } from "@/lib/locales";
import { prisma } from "@/lib/prisma";

/**
 * Письма auth-контура — сброс пароля и "кабинет готов". До 2026-08-08 оба были
 * захардкожены по-русски прямо в роутах, хотя правило проекта — все строки
 * только через /lang/*.json (см. CLAUDE.md, i18n). Один шаблон на оба, чтобы
 * вид письма не разъезжался: у них одинаковая форма — строка-вступление,
 * кнопка, мелкая сноска.
 */
export function renderAuthEmail(params: {
  lines: string[];
  buttonLabel: string;
  link: string;
  note: string;
}): string {
  const body = params.lines
    .map((line) => `    <p style="font-size:14px;margin:0 0 16px;">${line}</p>`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#F6F7F5;font-family:system-ui,sans-serif;color:#1B1F1D;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:24px;">
${body}
    <p style="margin:0 0 16px;">
      <a href="${params.link}" style="display:inline-block;background:#1B7A5C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;">${params.buttonLabel}</a>
    </p>
    <p style="font-size:12px;color:#6B7268;margin:0;">${params.note}</p>
  </div>
</body>
</html>`;
}

/**
 * Язык письма для конкретного пользователя: личное переопределение важнее
 * языка тенанта (то же правило, что в интерфейсе — User.locale ?? Tenant.locale,
 * см. 00-architecture.md). Русский — последний фолбэк, а не значение по
 * умолчанию для всех.
 */
export async function dictionaryForUser(userId: string): Promise<Dictionary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true, tenant: { select: { locale: true } } },
  });
  const locale = [user?.locale, user?.tenant?.locale].find((l) => l && isLocale(l));
  return getDictionary(locale ?? "ru");
}
