import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/normalize-email";
import { Prisma, type Tenant } from "@/generated/prisma/client";
import { provisionTenantFromPurchase } from "@/lib/fluentcart-provision";
import { verifyTenantBillingToken } from "@/lib/billing-token";
import { isLocale, type Locale } from "@/lib/locales";
import { notifyPayment } from "@/lib/platform-notify";

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Запоминаем покупателя FluentCart на тенанте, чтобы следующие события того же
 * человека (продление, отмена, возврат) находили кабинет сразу по customer_id —
 * без токена, которого у продления не будет, и без email, который может быть
 * чужим.
 */
async function bindCustomerId(tenant: Tenant, customerId: string | null): Promise<Tenant> {
  if (!customerId || tenant.fluentcartCustomerId === customerId) return tenant;

  try {
    return await prisma.tenant.update({
      where: { id: tenant.id },
      data: { fluentcartCustomerId: customerId },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Этот покупатель уже привязан к ДРУГОМУ кабинету — один человек завёл два
    // и платит за оба из одного аккаунта FluentCart. Поле уникально, и молча
    // перевесить его значило бы отвязать тот, первый кабинет от его собственной
    // подписки: его продления перестали бы находиться. Оставляем как есть —
    // текущее событие всё равно применится к тому тенанту, который нашёлся
    // выше, а он в этом запросе главнее.
    console.warn(
      "fluentcart customer",
      customerId,
      "is already bound to another tenant — keeping the existing binding, tenant",
      tenant.id
    );
    return tenant;
  }
}

// Реальная структура payload сверена с исходниками плагина FluentCart
// (fluent-cart-pro/app/Modules/Integrations/WebhookConnect.php,
// processAction() → "All Data" режим интеграции "Webhook"):
//
//   { order: {...}, customer: {...}, transactions: [...], order_items: [...],
//     subscriptions: [...], tax_rates: [...], shipping_address: {...},
//     billing_address: {...}, licenses: [...] }
//
// customer.email/id — FluentCart\App\Models\Customer (fillable: email, ...).
// order.customer_id — FluentCart\App\Models\Order.
// order_items[].post_id — FluentCart\App\Models\OrderItem (WP post ID товара).
// subscriptions[].product_id — FluentCart\App\Models\Subscription (тоже WP post ID).
//
// ВАЖНО: сам payload НЕ содержит имя сработавшего события (order_paid_done,
// subscription_renewed и т.п.) — это внутренний $hook, который
// WebhookConnect::processAction() не кладёт в тело запроса по умолчанию (см.
// IntegrationEventListener.php, $integrationArray['trigger'] существует
// только в PHP, до сериализации в JSON). Единственный практический способ
// без правки PHP-кода плагина — завести ОТДЕЛЬНЫЙ "Webhook"-фид в админке
// FluentCart на каждое нужное событие (Event Trigger в настройках фида) и
// прописать имя события статическим кастомным заголовком (Request Headers →
// "With Headers"), например "X-FluentCart-Event: order_paid_done". Секрет —
// туда же вторым заголовком. Роут (route.ts) читает оба из заголовков/query.
export interface ParsedFluentCartEvent {
  eventType: string;
  productIds: string[];
  customerId: string | null;
  customerEmail: string | null;
  // Имя покупателя — только чтобы у кабинета, созданного по факту покупки,
  // было осмысленное название компании вместо локальной части email
  // (см. lib/fluentcart-provision.ts). Владелец переименует.
  customerName: string | null;
  orderId: string | null;
  // subscriptions[0].next_billing_date — только для информационного
  // отображения "действует до" в кабинете, НЕ источник правды для логики
  // доступа (см. docs/fluentcart-webhook-schema.md §3 — "access end date"
  // как отдельное поле в FluentCart не существует, next_billing_date — это
  // просто дата следующего списания).
  nextBillingDate: string | null;
  // subscriptions[0].config.upgraded_from_sub_id, только если .is_upgraded
  // === 'yes' (docs/fluentcart-webhook-schema.md §5, п.2) — апгрейд плана не
  // имеет отдельного события, это обычный новый оплаченный заказ; сам
  // product_id новой подписки уже корректно переключает Tenant.packageId
  // через обычную ACTIVATING_EVENTS-ветку ниже, upgradedFromSubId нужен
  // только чтобы пометить это в WebhookEvent для наглядности в админке.
  upgradedFromSubId: string | null;
  // Язык страницы оформления заказа. Своего поля под язык у FluentCart нет,
  // это добавляет mu-плагин сайта (wp-content/mu-plugins/rentos-checkout-locale.php)
  // через фильтр fluent_cart/webhook/payload — до 2026-08-10 кабинет,
  // созданный по факту оплаты, всегда получал язык по умолчанию, и письмо
  // "кабинет готов" уходило на русском покупателю с любой языковой версии
  // сайта. Заказы, оформленные до появления плагина, поля не содержат —
  // отсюда null и прежний дефолт.
  locale: Locale | null;
  // Подписанный идентификатор кабинета из ссылки "Управлять подпиской"
  // (lib/billing-token.ts). Тем же mu-плагином, что и rentos_locale, только
  // из query-параметра ссылки, а не из Referer. Приоритетнее email — это и
  // есть защита от "заплатил с другого адреса, получил второй кабинет".
  tenantToken: string | null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function collectIds(...values: unknown[]): string[] {
  const ids: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && v.trim()) ids.push(v.trim());
    else if (typeof v === "number") ids.push(String(v));
  }
  return [...new Set(ids)];
}

export function parseFluentCartPayload(payload: unknown, eventType: string): ParsedFluentCartEvent {
  const p = (payload ?? {}) as Record<string, unknown>;
  const order = (p.order ?? {}) as Record<string, unknown>;
  const customer = (p.customer ?? {}) as Record<string, unknown>;
  const orderItems = Array.isArray(p.order_items) ? (p.order_items as Record<string, unknown>[]) : [];
  const subscriptions = Array.isArray(p.subscriptions) ? (p.subscriptions as Record<string, unknown>[]) : [];
  const subscription = subscriptions[0];
  const subscriptionConfig = (subscription?.config ?? {}) as Record<string, unknown>;

  return {
    eventType,
    productIds: collectIds(
      ...orderItems.map((item) => item.post_id),
      ...subscriptions.map((sub) => sub.product_id)
    ),
    customerId: firstString(customer.id, order.customer_id),
    customerEmail: firstString(customer.email),
    // wp_fct_customers.first_name/last_name — сверено с реальной таблицей.
    customerName:
      [firstString(customer.first_name), firstString(customer.last_name)].filter(Boolean).join(" ").trim() || null,
    orderId: firstString(order.id),
    nextBillingDate: firstString(subscription?.next_billing_date),
    upgradedFromSubId:
      subscriptionConfig.is_upgraded === "yes" ? firstString(subscriptionConfig.upgraded_from_sub_id) : null,
    locale: parseLocale(p.rentos_locale),
    tenantToken: firstString(p.rentos_tid),
  };
}

// Язык сайта — не язык RentOS: сайт живёт на пяти языках (ru/en/uk/it/ro), а
// приложение на пятнадцати, и чужое значение сюда приходить не должно.
// Незнакомое — как будто его и не было, кабинет получит язык по умолчанию.
function parseLocale(value: unknown): Locale | null {
  const raw = firstString(value);
  return raw && isLocale(raw) ? raw : null;
}

// Имена событий — дословно из FluentCart\App\Helpers\Status::eventTriggers()
// (fluent-cart/app/Helpers/Status.php) и IntegrationEventListener::registerHooks().
const ACTIVATING_EVENTS = new Set(["order_paid_done", "subscription_activated", "subscription_reactivated", "subscription_renewed"]);
// "subscription_canceled" сюда намеренно НЕ входит (решение пользователя
// 2026-07-11, docs/fluentcart-webhook-schema.md §5.1): отмена подписки в
// самом FluentCart не отзывает доступ немедленно — собственный
// $revokedHooks у плагина (IntegrationEventListener) тоже не включает это
// событие, доступ остаётся до конца оплаченного периода, только
// subscription_expired_validity (после next_billing_date + grace period)
// реально его обрывает. Событие всё равно логируется в WebhookEvent как
// любое другое — просто не меняет Tenant.subscriptionStatus.
// Отмена доступа не отзывает (см. комментарий выше) — но и делать вид, что
// ничего не произошло, кабинет не должен: до 2026-08-10 владелец отменённой
// подписки видел "Активен · Следующее списание 10.09", хотя списания уже не
// будет. Событие только проставляет отметку об отмене, статус не трогает;
// доступ обрывает потом subscription_eot/expired_validity из EXPIRING_EVENTS.
const CANCELING_EVENTS = new Set(["subscription_canceled"]);
const EXPIRING_EVENTS = new Set([
  "subscription_eot",
  "subscription_expired_validity",
  "order_status_changed_to_canceled",
  "order_fully_refunded",
]);

export type SyncResult =
  | { matched: true; tenantId: string; skippedReason?: string }
  | { matched: false; reason: string };

/**
 * Применяет событие FluentCart к Tenant (docs/spec/06-super-admin.md, п.5;
 * доп. инструкция "связывание тенанта с FluentCart" 2026-07-12). Порядок
 * поиска: токен кабинета из ссылки на оплату → fluentcartCustomerId → email
 * владельца (User.role=owner) → не найден. Тенант при регистрации уже
 * существует (сначала бесплатный план в RentOS, оплата через FluentCart —
 * позже) — здесь НИЧЕГО не создаётся автоматически, только связывается при
 * первом совпадении.
 * Бросает исключение только при настоящей внутренней ошибке — "тенант не
 * найден" это ожидаемый, не-исключительный результат (matched:false).
 */
export async function syncTenantFromFluentCartEvent(
  parsed: ParsedFluentCartEvent,
  eventReceivedAt: Date = new Date(),
  // Разрешение создать кабинет, если тенант не нашёлся (решение пользователя
  // 2026-08-08). Передаётся ТОЛЬКО из роута вебхука: при реплее после
  // регистрации (linkPendingFluentCartPurchases) тенант уже создан обычным
  // путём, и второй создавать нечего — поэтому по умолчанию выключено, а не
  // включено с оговоркой.
  provision?: { origin: string }
): Promise<SyncResult> {
  const pkg = parsed.productIds.length
    ? await prisma.package.findFirst({ where: { fluentcartProductId: { in: parsed.productIds } } })
    : null;

  // Токен из ссылки "Управлять подпиской" — раньше email и раньше customer_id
  // (решение пользователя 2026-08-10, см. lib/billing-token.ts). Именно он
  // закрывает случай "кабинет заведён на личный адрес, платит бухгалтерия":
  // адрес плательщика при живом токене больше ничего не решает. Токен приходит
  // только с той покупки, которую человек начал ИЗ кабинета; у холодной покупки
  // с сайта и у автопродлений его нет, и там всё работает как прежде.
  const tokenTenantId = parsed.tenantToken ? verifyTenantBillingToken(parsed.tenantToken) : null;
  if (parsed.tenantToken && !tokenTenantId) {
    // Не ошибка обработки: просроченная (месяц на раздумья вышел) или битая
    // ссылка просто откатывает нас на прежний поиск по email. Сам токен виден
    // в payload сохранённого WebhookEvent, если понадобится разобраться.
    console.warn("fluentcart webhook: tenant token present but invalid or expired");
  }

  let tenant = tokenTenantId ? await prisma.tenant.findUnique({ where: { id: tokenTenantId } }) : null;

  if (!tenant && parsed.customerId) {
    tenant = await prisma.tenant.findUnique({ where: { fluentcartCustomerId: parsed.customerId } });
  }

  if (!tenant && parsed.customerEmail) {
    // Email владельца хранится на User (role=owner), не дублируется на
    // Tenant — одна точка правды, тот же путь, что уже использует карточка
    // тенанта в админке для ownerEmail.
    const owner = await prisma.user.findFirst({
      // insensitive (аудит 2026-08-13): адрес приходит из FluentCart в том
      // виде, как его набрал покупатель, а в User.email он мог быть сохранён
      // в другом регистре — точное сравнение теряло тенант и покупка висела
      // непривязанной. См. lib/normalize-email.ts.
      where: { role: "owner", email: { equals: parsed.customerEmail, mode: "insensitive" } },
      select: { tenantId: true },
    });
    if (owner?.tenantId) {
      tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId } });
    }
  }

  if (tenant) {
    tenant = await bindCustomerId(tenant, parsed.customerId);
  }

  // Кабинета нет, но человек только что заплатил — создаём его и продолжаем
  // обрабатывать событие обычным путём ниже, чтобы пакет и статус подписки
  // ставились одним и тем же кодом, а не двумя.
  //
  // Только на активирующих событиях: создавать кабинет по отмене или возврату
  // бессмысленно. И только при известном email — владельца без адреса не
  // существует.
  if (!tenant && provision && parsed.customerEmail && ACTIVATING_EVENTS.has(parsed.eventType)) {
    const result = await provisionTenantFromPurchase({
      email: parsed.customerEmail,
      customerId: parsed.customerId,
      customerName: parsed.customerName,
      packageId: pkg?.id ?? null,
      origin: provision.origin,
      locale: parsed.locale,
    });
    if (result.created) {
      tenant = await prisma.tenant.findUnique({ where: { id: result.tenantId } });
    } else {
      return { matched: false, reason: result.reason };
    }
  }

  if (!tenant) {
    return { matched: false, reason: "no matching tenant by email or customer_id" };
  }

  const nextBillingDate = parsed.nextBillingDate ? new Date(parsed.nextBillingDate) : null;
  const currentPeriodEnd = nextBillingDate && !Number.isNaN(nextBillingDate.getTime()) ? nextBillingDate : null;

  let skippedReason = parsed.upgradedFromSubId
    ? `upgrade from subscription ${parsed.upgradedFromSubId}`
    : undefined;

  // Переупорядоченная доставка (найдено аудитом 2026-07-25) — событие
  // старше уже применённого lastFluentcartEventAt отклоняется целиком, ДО
  // разбора на ACTIVATING/EXPIRING: типичный сценарий — неудачная попытка
  // доставки order_paid_done ретраится провайдером и приходит ПОЗЖЕ более
  // свежего order_status_changed_to_canceled того же заказа (тот же order.id,
  // поэтому старая проверка isStaleOrder по номеру заказа его не ловит вовсе)
  // — без этой проверки поздний ретрай молча реактивировал бы уже честно
  // отменённую подписку.
  const isStaleEvent = tenant.lastFluentcartEventAt !== null && eventReceivedAt < tenant.lastFluentcartEventAt;

  // Тенант мог быть удалён МЕЖДУ чтением выше и update ниже (супер-админ
  // удаляет тенант ровно во время обработки его же вебхука) — без этого
  // catch update бросал бы P2025 наружу, роут отвечал бы 500,
  // WebhookEvent.status="failed" с сырым текстом ошибки Prisma, и FluentCart
  // бесконечно ретраил бы событие для тенанта, которого уже нет (аудит
  // 2026-07-24). Трактуем как штатное "не найдено", не как внутреннюю ошибку.
  try {
    if (isStaleEvent) {
      skippedReason = `stale event, received ${eventReceivedAt.toISOString()} but tenant already processed one from ${tenant.lastFluentcartEventAt!.toISOString()}`;
    } else if (ACTIVATING_EVENTS.has(parsed.eventType)) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          subscriptionStatus: "active",
          ...(pkg ? { packageId: pkg.id } : {}),
          // Обнуляем ручной "жёсткий" срок истечения — теперь источник правды
          // об окончании подписки это сам вебхук (следующий cancel/expire),
          // а не устаревшая дата из до-биллингового ручного режима.
          subscriptionExpiresAt: null,
          // Чисто информационное поле "действует до" в кабинете владельца —
          // логика доступа по нему не принимает решений, только status (см.
          // docs/fluentcart-webhook-schema.md §3).
          currentPeriodEnd,
          // Запоминаем, какой заказ сейчас "авторитетный" — см. проверку ниже
          // и комментарий у поля в schema.prisma.
          fluentcartOrderId: parsed.orderId,
          lastFluentcartEventAt: eventReceivedAt,
          // Оплатили снова после отмены (или отмену отменили) — отметка
          // снимается, иначе кабинет так и остался бы "Отменена" на живой
          // подписке.
          subscriptionCanceledAt: null,
        },
      });
    } else if (CANCELING_EVENTS.has(parsed.eventType)) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          // currentPeriodEnd намеренно не трогаем: оплаченный период
          // продолжается, и именно его дата показывается как "Действует до".
          subscriptionCanceledAt: eventReceivedAt,
          lastFluentcartEventAt: eventReceivedAt,
        },
      });
    } else if (EXPIRING_EVENTS.has(parsed.eventType)) {
      // Событие относится к УЖЕ НЕактуальному заказу того же клиента (например,
      // отменили/удалили старый дублирующий тестовый заказ, а более новый
      // остаётся активным) — не трогаем статус, просто логируем событие как
      // обработанное. Найдено 2026-07-12: без этой проверки такое событие
      // слепо переводило тенанта в expired поверх реально активной подписки.
      const isStaleOrder =
        tenant.fluentcartOrderId !== null && parsed.orderId !== null && tenant.fluentcartOrderId !== parsed.orderId;

      if (isStaleOrder) {
        skippedReason = `stale event from order ${parsed.orderId}, tenant is currently on order ${tenant.fluentcartOrderId}`;
      } else if (tenant.unlimited) {
        // Тот же guard, что уже есть в summary-scheduler.ts (реальный баг,
        // найден пользователем 2026-07-29: "Free должен действовать месяц,
        // если я не поставил осознанно безлимит") — там его применили к
        // истечению по таймеру, здесь пропустили: тенант с ручным
        // unlimited=true (Super Admin поставил VIP/партнёру), у которого
        // ЕСТЬ реальная подписка FluentCart, при её истечении вебхук всё
        // равно переводил status в "expired" — а proxy.ts блокирует все
        // мутации Владельца при expired/suspended независимо от unlimited,
        // то есть "Безлимит" переставал защищать ровно в тот момент,
        // когда должен был.
        skippedReason = `tenant ${tenant.id} has unlimited=true — subscription expiry ignored`;
      } else {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { subscriptionStatus: "expired", currentPeriodEnd: null, lastFluentcartEventAt: eventReceivedAt },
        });
      }
    }
  } catch (err) {
    if (!isRecordNotFound(err)) throw err;
    return { matched: false, reason: `tenant ${tenant.id} was deleted during processing` };
  }

  // Уведомление Super Admin'у — только о событиях, которые реально что-то
  // изменили: пропущенные как устаревшие или относящиеся к чужому заказу
  // (skippedReason) в группу не идут, иначе ретраи FluentCart засоряли бы её
  // сообщениями о том, чего не произошло.
  if (!skippedReason) {
    await notifyPayment({
      tenantId: tenant.id,
      companyName: tenant.name,
      email: parsed.customerEmail,
      packageName: pkg?.name ?? null,
      eventType: parsed.eventType,
    });
  }

  return {
    matched: true,
    tenantId: tenant.id,
    skippedReason,
  };
}

// Клиент мог купить подписку в FluentCart ДО регистрации в RentOS — тогда
// исходный вебхук не находит тенанта (matched:false, WebhookEvent.tenantId
// остаётся null) и ничего не создаёт (см. комментарий выше — тенант должен
// уже существовать). Вызывается сразу после регистрации нового Owner'а
// (доп. решение пользователя 2026-07-12): реплеит все ещё непривязанные
// события FluentCart для email этого владельца в хронологическом порядке —
// та же самая syncTenantFromFluentCartEvent, что и обычный вебхук, только
// путь поиска тенанта теперь находит его (он только что создан). Реплей по
// порядку, а не только последнее событие — если человек успел и купить, и
// отменить/сменить план ещё до регистрации, конечное состояние должно
// остаться таким же, как если бы тенант существовал всё это время.
export async function linkPendingFluentCartPurchases(email: string): Promise<number> {
  const pending = await prisma.webhookEvent.findMany({
    where: { provider: "fluentcart", tenantId: null },
    orderBy: { receivedAt: "asc" },
  });

  let linked = 0;
  for (const event of pending) {
    const parsed = parseFluentCartPayload(event.payload, event.eventType);
    if (normalizeEmail(parsed.customerEmail ?? "") !== normalizeEmail(email)) continue;

    const result = await syncTenantFromFluentCartEvent(parsed);
    if (result.matched) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: "processed", tenantId: result.tenantId, error: result.skippedReason ?? null },
      });
      linked++;
    }
  }
  return linked;
}
