import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { findUserByEmail } from "@/lib/normalize-email";
import { generateResetToken, hashPassword } from "@/lib/auth";
import { getDefaultPackage } from "@/lib/free-package";
import { generateUniqueSlug } from "@/lib/instructions/slug";
import { isReservedSlug, isSlugTaken } from "@/lib/landing/slug";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";
import { dictionaryForUser, renderAuthEmail } from "@/lib/auth-email";
import { notifyNewOwner } from "@/lib/platform-notify";
import type { Locale } from "@/lib/locales";

/**
 * Создание кабинета по факту оплаты в FluentCart (решение пользователя
 * 2026-08-08).
 *
 * Раньше покупка кабинет не создавала: вебхук искал тенанта по
 * fluentcartCustomerId/email, не находил и писал WebhookEvent.status="failed",
 * а связывание оставалось ручной работой супер-админа. Клиент при этом уже
 * заплатил и ждал, пока его свяжут. Обратный порядок (сначала
 * зарегистрировался, потом купил) работал и работает сам — см.
 * linkPendingFluentCartPurchases.
 *
 * Пароль здесь НЕ придумывается и не отправляется письмом. Владельцу уходит
 * ссылка "задайте пароль" — тот же механизм reset-токена, что у забытого
 * пароля, поэтому в базе не появляется ни одного пароля, который кто-то,
 * кроме владельца, когда-либо видел.
 */

// Ссылка живёт неделю, а не час, как обычный сброс пароля: письмо после
// покупки человек может открыть и на следующий день, и после выходных, а
// повторно "забыл пароль" он запросить не сможет — он ещё не знает, что у
// него вообще есть аккаунт.
const PROVISION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProvisionInput {
  email: string;
  customerId: string | null;
  /** Имя покупателя из FluentCart — станет названием компании, владелец переименует. */
  customerName: string | null;
  packageId: string | null;
  /** Origin приложения для ссылки в письме (берётся из самого запроса вебхука). */
  origin: string;
  /**
   * Язык страницы, на которой человек оформил покупку (mu-плагин сайта кладёт
   * его в вебхук полем rentos_locale). null — заказ старше этого плагина или
   * язык сайта не совпал ни с одним языком RentOS; тогда остаётся дефолт
   * модели, как было до 2026-08-10.
   */
  locale: Locale | null;
}

export type ProvisionResult =
  | { created: true; tenantId: string; userId: string }
  | { created: false; reason: string };

/**
 * Название компании: имя покупателя, если FluentCart его передал, иначе
 * локальная часть email. Владелец переименует на первом же экране — важно не
 * оставить поле пустым, оно видно в интерфейсе и в слаге публичных страниц.
 */
function tenantNameFrom(input: ProvisionInput): string {
  const name = input.customerName?.trim();
  if (name) return name;
  const local = input.email.split("@")[0] ?? "";
  return local.trim() || input.email;
}

export async function provisionTenantFromPurchase(input: ProvisionInput): Promise<ProvisionResult> {
  // email на User уникален глобально, поэтому чужой не-владелец с тем же
  // адресом (супер-админ с плейсхолдером, старый аккаунт) сделал бы create
  // ниже падающим. Такой случай — на ручной разбор, не на автоматику.
  // Без учёта регистра (аудит 2026-08-13): FluentCart отдаёт адрес так, как
  // его набрал покупатель, и точное сравнение заводило бы второй аккаунт на
  // тот же ящик вместо честного «разобрать вручную». См. normalize-email.ts.
  const existing = await findUserByEmail(input.email);
  if (existing) {
    return {
      created: false,
      reason: `user ${input.email} exists with role ${existing.role} but no tenant matched — link manually`,
    };
  }

  const pkg = input.packageId ? { id: input.packageId } : await getDefaultPackage();
  const name = tenantNameFrom(input);
  const slug = await generateUniqueSlug(name, async (candidate) => {
    if (isReservedSlug(candidate)) return true;
    return isSlugTaken(candidate);
  });

  const { token, tokenHash } = generateResetToken();

  // Тенант и владелец — одной транзакцией: тенант без владельца это мусор,
  // который потом некому ни открыть, ни удалить по email.
  const { tenantId, userId } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name,
        slug,
        packageId: pkg.id,
        // Статус и срок ставит сам вебхук, следом за этим созданием (ветка
        // ACTIVATING_EVENTS) — здесь намеренно не дублируем, чтобы не было
        // двух мест, решающих про подписку.
        ...(input.customerId ? { fluentcartCustomerId: input.customerId } : {}),
        // Язык той версии сайта, где человек купил. Без него кабинет и письмо
        // "задайте пароль" всегда были русскими — владелец сменит язык в
        // настройках одним переключателем, но начинать с чужого языка не то,
        // чего ждёт покупатель с /en/ или /ro/.
        ...(input.locale ? { locale: input.locale } : {}),
      },
    });

    const user = await tx.user.create({
      data: {
        email: input.email,
        // Случайный хеш, который не соответствует ни одному известному
        // паролю: войти можно только по ссылке ниже. Поле NOT NULL, поэтому
        // "нет пароля" выражается именно так, а не null.
        passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
        role: "owner",
        tenantId: tenant.id,
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: new Date(Date.now() + PROVISION_TOKEN_TTL_MS),
      },
    });

    return { tenantId: tenant.id, userId: user.id };
  });

  // pkg здесь может быть просто { id } (когда пакет пришёл из вебхука), имя
  // для уведомления берём из базы отдельным запросом — он всё равно один и
  // только в момент создания кабинета.
  const pkgName = (await prisma.package.findUnique({ where: { id: pkg.id }, select: { name: true } }))?.name ?? "";

  await notifyNewOwner({
    tenantId,
    companyName: name,
    email: input.email,
    packageName: pkgName,
    source: "purchase",
  });

  await sendWelcomeEmail(userId, input.email, `${input.origin}/reset-password?token=${token}`).catch((err) =>
    // Письмо — best-effort: кабинет уже создан и корректно связан с покупкой,
    // а вход владелец при необходимости получит через "Забыли пароль".
    console.error("fluentcart provision welcome email failed", err)
  );

  return { created: true, tenantId, userId };
}

// Язык — тенанта, через общий dictionaryForUser (то же, что у письма сброса
// пароля). У кабинета, созданного вебхуком, это язык страницы оформления
// заказа: своего поля под язык у FluentCart нет, его добавляет mu-плагин
// сайта (rentos-checkout-locale.php) полем rentos_locale в теле вебхука.
// Если поля нет (заказ старше плагина) — язык по умолчанию, как было раньше;
// по стране плательщика язык не угадываем, это было бы хуже дефолта.
async function sendWelcomeEmail(userId: string, email: string, link: string): Promise<void> {
  if (!(await isEmailConfigured())) return;

  const t = await dictionaryForUser(userId);
  const html = renderAuthEmail({
    lines: [t.authEmail.welcomeIntro, t.authEmail.welcomeLine],
    buttonLabel: t.authEmail.welcomeButton,
    link,
    note: t.authEmail.welcomeNote,
  });

  await sendEmail([email], t.authEmail.welcomeSubject, html);
}
