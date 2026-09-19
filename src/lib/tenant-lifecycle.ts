import { rm } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { CLEANUP_MIN_AGE_DAYS } from "@/lib/admin/tenant-cleanup";
import { dictionaryForUser, localeForUser, renderAuthEmail } from "@/lib/auth-email";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";
import { pricingUrl } from "@/lib/billing";
import { signTenantBillingToken } from "@/lib/billing-token";
import { notifyTenantDeleted } from "@/lib/platform-notify";
import { leaveChat } from "@/lib/telegram-bot";
import { getSystemSettingsConfig } from "@/lib/system-settings";
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
 * То же самое, но пригодное для показа в админ-модуле: дата удаления и
 * сколько дней до неё осталось — либо null, если автоудаление этого кабинета
 * не касается вовсе (оплата, безлимит, сезонная пауза).
 *
 * Считается ЗДЕСЬ и уходит в браузер готовым (роуты /api/admin/tenants и
 * .../[id]) по той же причине, что и cleanupVerdict в admin/tenant-cleanup.ts:
 * критерий защиты один — isPurgeProtected(), тот же, по которому реально
 * удаляет планировщик. Второй его экземпляр в клиентском коде разъехался бы с
 * планировщиком при первой же правке, и админка обещала бы дату, которая не
 * наступит (или наоборот — молчала бы о наступающей).
 */
export function purgeScheduleFor(
  tenant: PurgeCandidate,
  now: Date = new Date()
): { at: Date; daysLeft: number } | null {
  if (isPurgeProtected(tenant)) return null;
  const at = purgeDeadline(tenant.createdAt);
  // Вверх, а не вниз: «через 1 дн.» честнее для остатка в четыре часа, чем
  // «через 0 дн.». Отрицательного не бывает — просроченный кабинет живёт до
  // ближайшего тика планировщика, то есть меньше минуты.
  return { at, daysLeft: Math.max(0, Math.ceil((at.getTime() - now.getTime()) / DAY_MS)) };
}

/**
 * Чаты бота, которые принадлежат только этому тенанту: клиентская группа и
 * Telegram-каналы сводок. Чат, которым пользуется ещё кто-то — другой тенант
 * или группа уведомлений платформы (тот же бот), — не трогаем.
 */
async function tenantOnlyBotChats(tenantId: string): Promise<string[]> {
  const [group, channels] = await Promise.all([
    prisma.tenantPublicGroup.findUnique({ where: { tenantId }, select: { chatId: true } }),
    prisma.tenantSummaryChannel.findMany({ where: { tenantId, chatId: { not: null } }, select: { chatId: true } }),
  ]);
  const own = [...new Set([group?.chatId, ...channels.map((c) => c.chatId)].filter((id): id is string => !!id))];
  if (own.length === 0) return [];

  const [otherGroups, otherChannels, settings] = await Promise.all([
    prisma.tenantPublicGroup.findMany({ where: { tenantId: { not: tenantId }, chatId: { in: own } }, select: { chatId: true } }),
    prisma.tenantSummaryChannel.findMany({ where: { tenantId: { not: tenantId }, chatId: { in: own } }, select: { chatId: true } }),
    getSystemSettingsConfig(),
  ]);
  const shared = new Set([...otherGroups, ...otherChannels].map((c) => c.chatId));
  if (settings.adminNotifications.chatId) shared.add(settings.adminNotifications.chatId);
  return own.filter((id) => !shared.has(id));
}

/**
 * Все записи тенанта в базе — одной транзакцией, без внешних эффектов (бот,
 * файлы, сайт, уведомление — это deleteTenantEverywhere). Отдельной функцией,
 * чтобы проверять удаление на копии базы, не трогая Telegram и сайт.
 */
export async function deleteTenantRecords(tenantId: string): Promise<void> {
  const [landing, publicGroup, clientLinks] = await Promise.all([
    prisma.landing.findUnique({ where: { tenantId }, select: { id: true } }),
    prisma.tenantPublicGroup.findUnique({ where: { tenantId }, select: { chatId: true } }),
    prisma.clientTelegramLink.findMany({ where: { tenantId }, select: { chatId: true } }),
  ]);
  // Сессия бота — одна на Telegram-чат клиента и общая для всех тенантов.
  // Удаляем её только у тех клиентов, кого этот тенант был последним.
  const clientChats = [...new Set(clientLinks.map((l) => l.chatId))];
  const stillLinked = new Set(
    (
      await prisma.clientTelegramLink.findMany({
        where: { chatId: { in: clientChats }, tenantId: { not: tenantId } },
        select: { chatId: true },
      })
    ).map((l) => l.chatId)
  );
  const orphanChats = clientChats.filter((chatId) => !stillLinked.has(chatId));

  await prisma.$transaction([
    // Журнал исправлений связи с тенантом не имеет (entityId — голая строка),
    // каскад его не трогает, а в before/after лежат суммы, балансы и имена
    // клиентов. Удаляем всё, что относится к данным этого тенанта или
    // сделано его людьми, — до того, как исчезнут сами сущности.
    prisma.$executeRaw`
      DELETE FROM "CorrectionLog" c WHERE
        (c."entityType" = 'Tenant' AND c."entityId" = ${tenantId})
        OR c."correctedByUserId" IN (SELECT id FROM "User" WHERE "tenantId" = ${tenantId})
        OR c."correctedByOperatorId" IN (SELECT id FROM "Operator" WHERE "tenantId" = ${tenantId})
        OR (c."entityType" = 'MoneyOperation' AND c."entityId" IN (SELECT id FROM "MoneyOperation" WHERE "tenantId" = ${tenantId}))
        OR (c."entityType" = 'Shift' AND c."entityId" IN (SELECT id FROM "Shift" WHERE "tenantId" = ${tenantId}))
        OR (c."entityType" = 'AbonementWallet' AND c."entityId" IN (SELECT id FROM "AbonementWallet" WHERE "tenantId" = ${tenantId}))
        OR (c."entityType" = 'GoodsSale' AND c."entityId" IN (SELECT id FROM "GoodsSale" WHERE "tenantId" = ${tenantId}))
        OR (c."entityType" = 'ZoneSubmission' AND c."entityId" IN (
          SELECT zs.id FROM "ZoneSubmission" zs JOIN "ResultsSubmission" r ON r.id = zs."resultsSubmissionId" WHERE r."tenantId" = ${tenantId}))
        OR (c."entityType" IN ('Launch', 'TicketOrder', 'Ticket') AND c."entityId" IN (
          SELECT l.id FROM "Launch" l JOIN "Zone" z ON z.id = l."zoneId" JOIN "Point" p ON p.id = z."pointId" WHERE p."tenantId" = ${tenantId}
          UNION ALL
          SELECT o.id FROM "TicketOrder" o JOIN "Zone" z ON z.id = o."zoneId" JOIN "Point" p ON p.id = z."pointId" WHERE p."tenantId" = ${tenantId}
          UNION ALL
          SELECT t.id FROM "Ticket" t JOIN "TicketOrder" o ON o.id = t."orderId" JOIN "Zone" z ON z.id = o."zoneId" JOIN "Point" p ON p.id = z."pointId" WHERE p."tenantId" = ${tenantId}))
        OR (c."entityType" = 'AcknowledgmentRecord' AND c."entityId" IN (
          SELECT a.id FROM "AcknowledgmentRecord" a JOIN "Instruction" i ON i.id = a."instructionId" WHERE i."tenantId" = ${tenantId}))
    `,

    // Записи, у которых кроме каскадной связи есть связи SET NULL, — заранее,
    // пока живы их родители. Иначе Postgres удаляет родителя (зону, точку)
    // раньше самой записи, а обнуление другой её связи перепроверяет уже
    // несуществующего родителя — «база отклонила из-за внешнего ключа».
    // Найдено 2026-09-19 на park: не удалялся ни один тенант с пусками — ни
    // вручную, ни автоудалением. Список — все такие таблицы схемы
    // (docs/spec/06-super-admin.md, «Удаление»); дочерние строки (оплаты
    // частями, билеты заказа) уходят каскадом от них.
    prisma.abonementTransaction.deleteMany({ where: { wallet: { tenantId } } }),
    prisma.counterTapEvent.deleteMany({ where: { point: { tenantId } } }),
    prisma.launch.deleteMany({ where: { zone: { point: { tenantId } } } }),
    prisma.ticketOrder.deleteMany({ where: { zone: { point: { tenantId } } } }),
    prisma.goodsSale.deleteMany({ where: { tenantId } }),
    prisma.goodsHeldOrder.deleteMany({ where: { tenantId } }),
    prisma.goodsReconciliation.deleteMany({ where: { tenantId } }),
    prisma.goodsRevision.deleteMany({ where: { tenantId } }),
    prisma.moneyOperation.deleteMany({ where: { tenantId } }),
    prisma.asset.deleteMany({ where: { zone: { point: { tenantId } } } }),
    prisma.landing.deleteMany({ where: { tenantId } }),

    // Хранятся без связи с тенантом — каскад их не видит.
    ...(landing ? [prisma.landingVisitorSeen.deleteMany({ where: { landingId: landing.id } })] : []),
    prisma.webhookEvent.deleteMany({ where: { tenantId } }),
    prisma.clientBotSession.deleteMany({ where: { chatId: { in: orphanChats } } }),
    prisma.clientBotSession.updateMany({ where: { pendingTenantId: tenantId }, data: { pendingTenantId: null } }),
    // Недоделанная регистрация к этому тенанту — вместе с введённым телефоном.
    prisma.clientBotSession.updateMany({
      where: { pendingRegistrationTenantId: tenantId },
      data: { pendingRegistrationTenantId: null, pendingRegistrationPhone: null, awaitingRegistrationName: false },
    }),
    ...(publicGroup?.chatId
      ? [
          prisma.clientBotSession.updateMany({
            where: { pendingWelcomeGroupChatId: publicGroup.chatId },
            data: { pendingWelcomeGroupChatId: null, pendingWelcomeMessageId: null },
          }),
        ]
      : []),

    // Остальное — клиенты, абонементы, сотрудники, точки, зоны, смены,
    // привязки к Telegram, каналы сводок, пуш-подписки — каскадом.
    prisma.tenant.delete({ where: { id: tenantId } }),
  ]);
}

/**
 * Удаление кабинета целиком (решение владельца 2026-09-19: «полное
 * удаление» — клиенты, бот, медиафайлы, всё, что связано с владельцем):
 * сам тенант со всеми данными, журнал исправлений по его данным, выход бота
 * из его групп, загруженные файлы на диске и учётная запись на маркетинговом
 * сайте. Одна функция на все три вызова — планировщик, массовая чистка и
 * ручное удаление из админки, — иначе «удаляется везде» разъедется по трём
 * местам при первой же правке.
 *
 * Порядок важен: сайту сообщаем ПОСЛЕ успешного удаления в RentOS, иначе при
 * ошибке удаления человек остался бы с живым кабинетом, но без учётной записи
 * на сайте и без возможности войти через единый вход.
 */
export async function deleteTenantEverywhere(
  tenantId: string,
  ownerEmail: string | null,
  reason: "auto" | "manual" = "auto"
): Promise<void> {
  // Имя и чаты читаем ДО удаления — после него их уже не найти.
  const [tenant, chatsToLeave] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    tenantOnlyBotChats(tenantId),
  ]);

  await deleteTenantRecords(tenantId);

  // Бот выходит из групп и каналов владельца — иначе остался бы в них немым
  // участником. Best-effort: кабинета уже нет, а бот мог быть удалён из
  // группы раньше.
  for (const chatId of chatsToLeave) {
    await leaveChat(chatId).catch((err) => console.error("bot leaveChat failed", chatId, err));
  }

  // Файлы (public/uploads/<tenantId>/, см. src/lib/uploads.ts) лежат на диске,
  // каскад Prisma их не трогает. Тенант уже удалён, поэтому неудача не
  // откатывает удаление, но и молчать о ней нельзя: до 2026-09-19 ошибка
  // глушилась, и папка park пережила его удаление незамеченной (приложение
  // не имело прав на папку загрузок — см. SITE_UID в docker-compose.prod.yml).
  await rm(path.join(process.cwd(), "public", "uploads", tenantId), { recursive: true, force: true }).catch((err) =>
    console.error("tenant uploads removal failed", tenantId, err)
  );

  if (ownerEmail) {
    await deleteSiteAccount(ownerEmail).catch((err) =>
      // Best-effort по той же причине: кабинета уже нет, а осиротевшая учётка
      // на сайте безобидна (роль rentos_client умеет только read) и будет
      // подобрана следующей сверкой.
      console.error("site account deletion failed", ownerEmail, err)
    );
  }

  await notifyTenantDeleted({ companyName: tenant?.name ?? tenantId, email: ownerEmail, reason });
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
        await sendDeletionNotice(tenant.id, owner.id, owner.email, deadline);
        await prisma.tenant.update({
          where: { id: tenant.id },
          // Первое письмо тоже отмечаем: тенант мог пересечь оба порога разом
          // (планировщик стоял, кабинет создан давно) — второе письмо в этом
          // случае единственное нужное, первое уже неактуально.
          data: { deletionFinalNoticeSentAt: now, deletionNoticeSentAt: tenant.deletionNoticeSentAt ?? now },
        });
        warned++;
      } else if (now >= firstNoticeAt && !tenant.deletionNoticeSentAt) {
        await sendDeletionNotice(tenant.id, owner.id, owner.email, deadline);
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

async function sendDeletionNotice(tenantId: string, userId: string, email: string, deadline: Date): Promise<void> {
  if (!(await isEmailConfigured())) return;

  const [t, locale] = await Promise.all([dictionaryForUser(userId), localeForUser(userId)]);

  const html = renderAuthEmail({
    lines: [t.authEmail.deletionIntro, t.authEmail.deletionLine.replace("{date}", formatDeadline(deadline, locale))],
    buttonLabel: t.authEmail.deletionButton,
    // Ссылка ведёт на страницу цен той же языковой версии сайта, что и
    // "Управлять подпиской" в кабинете, и с тем же токеном кабинета: здесь он
    // важнее всего остального: письмо получает владелец, у которого в кабинете
    // уже есть данные, и оплата с адреса бухгалтерии не должна завести ему
    // второй, пустой кабинет, пока этот удаляется по расписанию.
    link: pricingUrl(locale, signTenantBillingToken(tenantId)),
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
