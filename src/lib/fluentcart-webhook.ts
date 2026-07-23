import { prisma } from "@/lib/prisma";

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
    orderId: firstString(order.id),
    nextBillingDate: firstString(subscription?.next_billing_date),
    upgradedFromSubId:
      subscriptionConfig.is_upgraded === "yes" ? firstString(subscriptionConfig.upgraded_from_sub_id) : null,
  };
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
 * поиска: fluentcartCustomerId → email владельца (User.role=owner) → не
 * найден. Тенант при регистрации уже существует (сначала бесплатный план в
 * RentOS, оплата через FluentCart — позже) — здесь НИЧЕГО не создаётся
 * автоматически, только связывается по email при первом совпадении.
 * Бросает исключение только при настоящей внутренней ошибке — "тенант не
 * найден" это ожидаемый, не-исключительный результат (matched:false).
 */
export async function syncTenantFromFluentCartEvent(
  parsed: ParsedFluentCartEvent,
  eventReceivedAt: Date = new Date()
): Promise<SyncResult> {
  const pkg = parsed.productIds.length
    ? await prisma.package.findFirst({ where: { fluentcartProductId: { in: parsed.productIds } } })
    : null;

  let tenant = parsed.customerId
    ? await prisma.tenant.findUnique({ where: { fluentcartCustomerId: parsed.customerId } })
    : null;

  if (!tenant && parsed.customerEmail) {
    // Email владельца хранится на User (role=owner), не дублируется на
    // Tenant — одна точка правды, тот же путь, что уже использует карточка
    // тенанта в админке для ownerEmail.
    const owner = await prisma.user.findFirst({
      where: { role: "owner", email: parsed.customerEmail },
      select: { tenantId: true },
    });
    if (owner?.tenantId) {
      tenant = await prisma.tenant.update({
        where: { id: owner.tenantId },
        data: parsed.customerId ? { fluentcartCustomerId: parsed.customerId } : {},
      });
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
    } else {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { subscriptionStatus: "expired", currentPeriodEnd: null, lastFluentcartEventAt: eventReceivedAt },
      });
    }
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
    if (parsed.customerEmail !== email) continue;

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
