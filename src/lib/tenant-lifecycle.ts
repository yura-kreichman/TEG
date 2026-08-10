import { rm } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { CLEANUP_MIN_AGE_DAYS } from "@/lib/admin/tenant-cleanup";
import { dictionaryForUser, localeForUser, renderAuthEmail } from "@/lib/auth-email";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";
import { pricingUrl } from "@/lib/billing";
import type { Locale } from "@/lib/locales";

/**
 * Автоматическое удаление брошенных Free-кабинетов (решение пользователя
 * 2026-08-10): «Free без безлимита через N дней удаляется везде безвозвратно».
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ src/lib/admin/tenant-cleanup.ts. Тот отбирает
 * ПУСТЫЕ регистрации и оставляет `abandoned` (кабинеты с данными) навсегда —
 * «прокат сезонный, зимой простой на несколько месяцев это норма». Здесь
 * удаляются и кабинеты с данными, то есть прежнее правило сознательно
 * отменено. Компенсация ровно за этим: два письма и предупреждение в шапке
 * кабинета до удаления, а не молчаливый снос. Тот же порог 60 дней от
 * регистрации взят намеренно — два разных срока для «удалить пустой» и
 * «удалить с данными» разошлись бы при первой же правке.
 */
export const PURGE_AFTER_DAYS = CLEANUP_MIN_AGE_DAYS;

// День 37 — первое письмо, день 53 — второе, оно же включает предупреждение в
// шапке кабинета. Считаются от дедлайна, а не от регистрации: сдвинув
// PURGE_AFTER_DAYS, оба предупреждения поедут за ним сами.
export const FIRST_NOTICE_DAYS_BEFORE = 23;
export const FINAL_NOTICE_DAYS_BEFORE = 7;

const DAY_MS = 86_400_000;

export interface PurgeCandidate {
  createdAt: Date;
  unlimited: boolean;
  subscriptionStatus: string;
  fluentcartCustomerId: string | null;
  package: { fluentcartProductId: string | null };
}

/**
 * Кого автоудаление не касается вообще. Тот же набор защит, что у
 * classifyTenant() в admin/tenant-cleanup.ts, и по тем же причинам:
 *
 * - `unlimited` — ручной рубильник Super Admin'а, такой тенант ведётся вручную;
 * - `paused` — сезонная пауза, которую включил сам владелец;
 * - `fluentcartCustomerId` / платный пакет — за кабинетом стоят деньги. Это и
 *   есть ответ на «что делать с теми, кто когда-либо платил» (решение
 *   пользователя 2026-08-10): любой след покупки снимает кабинет с
 *   рассмотрения навсегда, даже если сейчас человек на Free.
 */
export function isPurgeProtected(tenant: PurgeCandidate): boolean {
  return (
    tenant.unlimited ||
    tenant.subscriptionStatus === "paused" ||
    tenant.fluentcartCustomerId !== null ||
    tenant.package.fluentcartProductId !== null
  );
}

/** Момент, в который кабинет будет удалён, если ничего не изменится. */
export function purgeDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PURGE_AFTER_DAYS * DAY_MS);
}

/**
 * Удаление кабинета целиком: сам тенант (каскадом уносит все связанные
 * таблицы), загруженные файлы на диске и учётная запись на маркетинговом
 * сайте. Одна функция на все три вызова — планировщик, массовая чистка и
 * ручное удаление из админки, — иначе «удаляется везде» разъедется по трём
 * местам при первой же правке.
 *
 * Порядок важен: сайту сообщаем ПОСЛЕ успешного удаления в RentOS, иначе при
 * ошибке удаления человек остался бы с живым кабинетом, но без учётной записи
 * на сайте и без возможности войти через единый вход.
 */
export async function deleteTenantEverywhere(tenantId: string, ownerEmail: string | null): Promise<void> {
  await prisma.tenant.delete({ where: { id: tenantId } });

  // Файлы (public/uploads/<tenantId>/, см. src/lib/uploads.ts) лежат на диске,
  // каскад Prisma их не трогает. Best-effort: тенант уже удалён, сиротская
  // папка хуже, чем неудачная попытка её убрать.
  await rm(path.join(process.cwd(), "public", "uploads", tenantId), { recursive: true, force: true }).catch(() => {});

  if (ownerEmail) {
    await deleteSiteAccount(ownerEmail).catch((err) =>
      // Best-effort по той же причине: кабинета уже нет, а осиротевшая учётка
      // на сайте безобидна (роль rentos_client умеет только read) и будет
      // подобрана следующей сверкой.
      console.error("site account deletion failed", ownerEmail, err)
    );
  }
}

/**
 * Один проход: разослать предупреждения тем, кому пора, и удалить тех, у кого
 * срок вышел. Вызывается из планировщика (раз в минуту) — отсюда отметки
 * deletionNoticeSentAt/deletionFinalNoticeSentAt: без них письмо уходило бы
 * каждую минуту.
 *
 * Выборка узкая: только Free-пакеты без следов оплаты и старше дня первого
 * предупреждения. На каждом тике это один индексируемый запрос, обходить всех
 * тенантов ради этого не нужно.
 */
export async function runTenantPurgeCycle(now: Date = new Date()): Promise<{ warned: number; deleted: number }> {
  const firstNoticeAge = PURGE_AFTER_DAYS - FIRST_NOTICE_DAYS_BEFORE;

  const candidates = await prisma.tenant.findMany({
    where: {
      createdAt: { lte: new Date(now.getTime() - firstNoticeAge * DAY_MS) },
      unlimited: false,
      fluentcartCustomerId: null,
      subscriptionStatus: { not: "paused" },
      package: { fluentcartProductId: null },
    },
    include: {
      package: { select: { fluentcartProductId: true } },
      users: {
        where: { role: "owner" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, email: true },
      },
    },
  });

  let warned = 0;
  let deleted = 0;

  for (const tenant of candidates) {
    // Повторная проверка тем же предикатом, что и в админке: выборка выше
    // отбирает по тем же полям, но защита должна быть в одном месте на случай,
    // если условия where когда-нибудь разъедутся с правилом.
    if (isPurgeProtected(tenant)) continue;

    const deadline = purgeDeadline(tenant.createdAt);
    const owner = tenant.users[0] ?? null;

    try {
      if (now >= deadline) {
        await deleteTenantEverywhere(tenant.id, owner?.email ?? null);
        deleted++;
        continue;
      }

      if (!owner) continue;

      const finalNoticeAt = new Date(deadline.getTime() - FINAL_NOTICE_DAYS_BEFORE * DAY_MS);
      const firstNoticeAt = new Date(deadline.getTime() - FIRST_NOTICE_DAYS_BEFORE * DAY_MS);

      if (now >= finalNoticeAt && !tenant.deletionFinalNoticeSentAt) {
        await sendDeletionNotice(owner.id, owner.email, deadline);
        await prisma.tenant.update({
          where: { id: tenant.id },
          // Первое письмо тоже отмечаем: тенант мог пересечь оба порога разом
          // (планировщик стоял, кабинет создан давно) — второе письмо в этом
          // случае единственное нужное, первое уже неактуально.
          data: { deletionFinalNoticeSentAt: now, deletionNoticeSentAt: tenant.deletionNoticeSentAt ?? now },
        });
        warned++;
      } else if (now >= firstNoticeAt && !tenant.deletionNoticeSentAt) {
        await sendDeletionNotice(owner.id, owner.email, deadline);
        await prisma.tenant.update({ where: { id: tenant.id }, data: { deletionNoticeSentAt: now } });
        warned++;
      }
    } catch (err) {
      // Один проблемный тенант не должен останавливать остальных: следующий
      // тик попробует снова, отметки о письмах ставятся только после успеха.
      console.error("tenant purge cycle failed for", tenant.id, err);
    }
  }

  return { warned, deleted };
}

/** Дата в письме и в шапке кабинета — на языке получателя, не в ISO. */
export function formatDeadline(deadline: Date, locale: Locale): string {
  return deadline.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function sendDeletionNotice(userId: string, email: string, deadline: Date): Promise<void> {
  if (!(await isEmailConfigured())) return;

  const [t, locale] = await Promise.all([dictionaryForUser(userId), localeForUser(userId)]);

  const html = renderAuthEmail({
    lines: [t.authEmail.deletionIntro, t.authEmail.deletionLine.replace("{date}", formatDeadline(deadline, locale))],
    buttonLabel: t.authEmail.deletionButton,
    // Ссылка ведёт на страницу цен той же языковой версии сайта, что и
    // "Управлять подпиской" в кабинете.
    link: pricingUrl(locale),
    note: t.authEmail.deletionNote,
  });

  await sendEmail([email], t.authEmail.deletionSubject, html);
}

/**
 * Просьба к маркетинговому сайту удалить учётную запись владельца. На сайте
 * запись заводит либо FluentCart при покупке, либо единый вход при первом
 * заходе (роль rentos_client) — и до 2026-08-10 она оставалась там навсегда
 * после удаления кабинета, накапливаясь без всякой возможности сверить
 * вручную.
 *
 * Подпись — тем же общим секретом, что и единый вход (SSO_SHARED_SECRET здесь,
 * константа RENTOS_SSO_SECRET на сайте): отдельный секрет ради одного вызова
 * плодил бы ещё одну переменную окружения, которую надо не забыть при
 * развёртывании. Решение «удалять или нет» принимает сайт — он один знает про
 * заказы FluentCart, а без этой проверки удаление осиротило бы историю покупок.
 */
async function deleteSiteAccount(email: string): Promise<void> {
  const secret = process.env.SSO_SHARED_SECRET;
  const site = process.env.MARKETING_SITE_URL ?? "https://rentos365.app";
  if (!secret) return;

  const timestamp = Date.now().toString();
  const { createHmac } = await import("node:crypto");
  const signature = createHmac("sha256", secret).update(`${email}:${timestamp}`).digest("hex");

  const response = await fetch(`${site}/?rentos_delete_account=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, timestamp, signature }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`site responded ${response.status}`);
  }
}
