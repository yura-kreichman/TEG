# FluentCart — реальная схема вебхука и подписки (справочник)

Составлено 2026-07-11 чтением исходников `FluentCart/fluent-cart` (free) и `FluentCart/fluent-cart-pro` (pro), предоставленных пользователем в корне репозитория только для справки — **эти файлы не редактировались и не должны редактироваться**. Уточняет и местами исправляет более раннее предположение, записанное в `docs/spec/06-super-admin.md`, п.5.

## 1. Интеграция Webhook — как она реально формирует запрос

`fluent-cart-pro/app/Modules/Integrations/WebhookConnect.php`. Настройки фида: `request_url`, `request_method`, `request_format`, `request_headers` (`no_headers` | `custom_headers` — свободные пары `name`/`value`, **имени события среди них нет по умолчанию**), `request_body` (`all_data` | `selected_fields`), `event_trigger` (массив имён событий — см. §2).

**Подтверждено**: своего механизма передать имя сработавшего события или секрет в теле/заголовке нет — единственный практический способ (как и предполагалось раньше) — завести отдельный Webhook-фид на каждое нужное событие и прописать `X-FluentCart-Event`/секрет вручную через `custom_headers`.

При `request_body.type = all_data` тело строится в `processAction()`:

```php
$payloadBody = [
    'order'            => Arr::only($order->toArray(), Order::getFillable() + ['id']),
    'customer'         => $order->customer?->toArray() ?? [],
    'transactions'     => $order->transactions?->toArray() ?? [],
    'order_items'      => $order->order_items?->toArray() ?? [],
    'subscriptions'    => $order->subscriptions?->toArray() ?? [],
    'tax_rates'        => $order->orderTaxRates?->toArray() ?? [],
    'shipping_address' => $order->shipping_address?->toArray() ?? [],
    'billing_address'  => $order->billing_address?->toArray() ?? [],
    'licenses'         => $order->getLicenses([])?->toArray() ?? [],
];
```

**Важный нюанс, которого не было в прошлой версии**: только `order` обрезан до `$fillable`. Остальные ключи — **полный** `toArray()` модели, включая все append-аксессоры (см. §3-4). Доставка — `wp_remote_request()`, без ретраев; неуспех логируется в `Order::addLog()`, не в отдельную таблицу.

## 2. Список событий, доступных как триггер вебхука

Источник истины — `Status::eventTriggers()` (список в UI) и `IntegrationEventListener::registerHooks()` (реальная подписка на хуки) — совпадают 1:1.

| Событие (строка) | Когда фактически стреляет |
|---|---|
| `order_paid_done` | Оплата заказа прошла (любой тип — payment/subscription/renewal) |
| `subscription_activated` | Подписка создана впервые (любой гейтвей: Stripe/PayPal/Paddle/Mollie/AuthorizeNet/COD) |
| `subscription_reactivated` | Клиент вручную реактивировал canceled/expired подписку |
| `subscription_canceled` | Подписка отменена — **но см. важный нюанс в §5** |
| `subscription_renewed` | Успешный автосписание/продление |
| `subscription_eot` | Конечный тарифный план (`bill_times > 0`) исчерпал число списаний ("End of Term") — форсированная отмена без повторного `subscription_canceled` |
| `subscription_expired_validity` | Часовой cron `checkAndExpireSubscriptions()` признал доступ истёкшим (`next_billing_date` + grace period, см. §3) |
| `order_status_changed_to_canceled` | Статус заказа сменён на `canceled` |
| `order_fully_refunded` | Заказ возвращён полностью |
| `shipping_status_changed_to_shipped` / `_delivered` | Доставка (нерелевантно для RentOS) |

**Не выбираются как триггер вебхука вообще** (существуют как хуки, но нет чекбокса в админке): `order_refunded`, `order_partially_refunded`, `order_status_changed` (общий), `payment_status_changed_to_*`, `fluent_cart/order/upgraded`, `fluent_cart/customer_status_updated`. Если частичные возвраты когда-нибудь понадобятся — это ограничение самого плагина, доступа к ним через обычный Webhook-фид нет.

**Апгрейда/даунгрейда плана как отдельного события НЕТ** — см. §5.

## 3. Поля payload, статусы, «дата окончания доступа», grace period

Верхнеуровневые ключи — как и предполагалось: `order`, `customer`, `transactions`, `order_items`, `subscriptions`, `tax_rates`, `shipping_address`, `billing_address`, `licenses`.

- **email/customer_id**: `customer.email`, `customer.id` (полный `toArray()`, `id` присутствует). `order.customer_id` — та же связь на заказе.
- **product/variation**: `order_items[].post_id` (WP post ID товара) и `order_items[].object_id` (id вариации). У подписки — **другое имя того же самого**: `subscriptions[].product_id` (WP post ID) и `subscriptions[].variation_id` (id тарифа/плана). Если пакеты RentOS когда-нибудь привяжутся не к товару целиком, а к конкретной вариации/тарифу — понадобится `variation_id`, не только `product_id`.
- **Статус подписки**: колонка `status`, полный словарь значений — `pending, intended, trialing, active, canceled, paused, past_due, expired, failing, expiring, completed, authenticated, created`. Гораздо шире, чем 2 условных ведра (активирующие/истекающие события) в текущем коде.
  **Есть отдельный вычисляемый `overridden_status`** (append-аксессор, тоже попадает в payload) — сглаживает `active`↔`trialing` в зависимости от `is_trial_days_simulated`/дней триала. Для отображения статуса клиенту он точнее сырого `status`.
- **Следующее списание**: `subscriptions[].next_billing_date` — реальная колонка, `null` при пустом значении. Это **есть** в payload.
- **«Дата окончания доступа» (access end date) — отдельного поля НЕТ нигде**, ни в модели, ни в payload. Это чисто процедурная логика внутри часового cron `Subscription::checkAndExpireSubscriptions()`:
  - реальная дата = `next_billing_date` + grace period (по `billing_interval`) — но нигде не сохраняется, кроме как триггер для смены `status → expired`;
  - у подписок со `status = canceled` grace period **не даётся вообще** — доступ обрывается ровно в `next_billing_date`;
  - у `active/trialing/expiring/past_due` — доступ продлевается на grace period.
  Если RentOS хочет показывать «доступ до X» — это придётся считать самостоятельно (`next_billing_date` + `getSubscriptionsGracePeriodDays(billing_interval)`, 0 дней если `status === canceled`), FluentCart это значение не отдаёт.
- **Grace period**: `SubscriptionHelper::getSubscriptionsGracePeriodDays()` — `{daily:1, weekly:3, monthly:7, quarterly:15, half_yearly:15, yearly:15}`, дефолт 7 при неизвестном интервале. Глобально, **без** оверрайда по товару. Промежуточного статуса вроде «grace/past_due» на время самого grace-периода cron не выставляет — подписка либо уже носит `past_due`/`failing` от гейтвея (дело гейтвея, не этого cron), либо остаётся как есть до истечения.

## 4. Модели — что реально существует в БД FluentCart

**Subscription** (`fct_subscriptions`) — колонки: `customer_id, parent_order_id, product_id, item_name, variation_id, billing_interval, signup_fee, quantity, recurring_amount, recurring_tax_total, recurring_total, bill_times, bill_count, expire_at, trial_ends_at, canceled_at, restored_at, collection_method, trial_days, vendor_customer_id, vendor_plan_id, vendor_subscription_id, next_billing_date, status, original_plan, vendor_response, current_payment_method, config`. `config` (JSON) — свободный бэг для метаданных жизненного цикла, включая апгрейды (см. §5).

**Order** (`fct_orders`) — `status, parent_id, invoice_no, receipt_number, fulfillment_type, type (payment/subscription/renewal), customer_id, payment_method, payment_status (pending/paid/partially_paid/failed/refunded/partially_refunded/authorized), currency, subtotal, ...total_amount, total_paid, total_refund, mode (test/live), shipping_status, config`.

**OrderItem** — `post_id, object_id, payment_type (onetime/subscription/fee/signup_fee/bundle), quantity, unit_price, line_total, tax_amount, discount_total, refund_total`.

**OrderTransaction** (`fct_order_transactions`) — `order_id, vendor_charge_id, payment_method, transaction_type (charge/refund/dispute), subscription_id, status (succeeded/authorized/pending/refunded/failed/dispute_lost), total, created_at` — реальный журнал списаний/возвратов.

**License** (`fct_licenses`, только pro) — `status (active/disabled/expired), limit, activation_count, license_key, product_id, variation_id, order_id, customer_id, expiration_date, subscription_id`.

Для учёта продаж/выручки: `Status::getReportStatuses()` = `[paid, refunded, partially_paid, partially_refunded]` — канонический набор «это считается продажей», используется самим FluentCart для LTV-подсчётов клиента. Разумный ориентир, если RentOS когда-нибудь будет агрегировать выручку по вебхукам, а не только статус подписки.

## 4.1. Проверено 2026-07-11: `product_id` общий для всех вариаций одного товара

RentOS-планы (Free/Starter/Pro/Max) будут в FluentCart отдельными товарами, а Monthly/Annual — Simple Variations внутри одного товара. Проверено чтением миграций/моделей (не догадка): вариация — это **не отдельный WP-пост**, а строка в `fct_product_variations` со своим PK (`id`) и колонкой `post_id`, указывающей на общий родительский товар.

- `ProductController.php`: один `wp_insert_post()` на товар; каждая вариация создаётся как `ProductVariation::create(['post_id' => $createdPostId, ...])` — тот же `post_id`, что и у товара.
- `ProductVariationMigrator.php`: `fct_product_variations` имеет свой `id` (это и есть `variation_id`/`object_id` в заказах/подписках) + `post_id` (общий для всех вариаций одного товара).
- `Subscription.php`/`OrderItem.php`: `product()` — связь по `product_id`/`post_id` (общий), `variation()` — отдельная связь по `variation_id`/`object_id` (уникален на вариацию).

**Вывод**: текущая схема маппинга `Package.fluentcartProductId` (одно поле, без учёта вариации) — **корректна и менять её не нужно**. `product_id` в вебхуке будет одинаковым что для Monthly, что для Annual покупки одного пакета — этого достаточно, чтобы определить, какой именно `Package` покупают. `variation_id`/`object_id` в payload есть (см. §3), но нужен только если когда-нибудь понадобится узнавать интервал (Monthly/Annual) из вебхука напрямую, а не из `subscriptions[].billing_interval` (который и так уже есть в payload и проще).

## 5. Важные расхождения с текущей реализацией RentOS

Не исправлены автоматически — по инструкции промпта, решения ниже требуют подтверждения, не вносились в код без согласования:

1. **Решено пользователем 2026-07-11, исправлено в коде**: `subscription_canceled` раньше мгновенно переводил `Tenant.subscriptionStatus` в `expired`. Собственная логика FluentCart (список `$revokedHooks` в `IntegrationEventListener`, используемый для отзыва доступа у LMS/CRM-интеграций) **не включает `subscription_canceled`** — только `subscription_expired_validity`, `order_fully_refunded`, `order_status_changed_to_canceled`. По мнению самого FluentCart «отменено» ≠ «доступ пропал сейчас же» — клиент отменил автопродление, но должен пользоваться до конца оплаченного периода. RentOS теперь ведёт себя так же: `subscription_canceled` убран из `EXPIRING_EVENTS` в `src/lib/fluentcart-webhook.ts` — событие по-прежнему логируется в `WebhookEvent`, но `Tenant.subscriptionStatus` не трогает; доступ обрывает только `subscription_expired_validity` (когда `next_billing_date` реально пройдёт).
2. **Апгрейд/даунгрейд плана не имеет отдельного события.** Технически это отмена старой подписки (`fire_hooks: false` — `subscription_canceled` **не** стреляет) + обычный новый оплаченный заказ (стреляет `order_paid_done`/`subscription_activated` как за свежую покупку). Определить апгрейд можно только по `subscriptions[].config.is_upgraded === 'yes'` + `config.upgraded_from_sub_id` на **новой** подписке в том же payload.
3. **Статусов подписки в FluentCart 13**, RentOS сейчас реагирует только на факт события, не читая `status`/`overridden_status` вообще. `past_due`, `failing`, `paused`, `intended` — состояния, которые FluentCart умеет иметь, но ни одно не порождает отдельное вебхук-событие (нет чекбокса в UI) — RentOS узнает о них только если начнёт читать поле статуса из payload любого пришедшего события.
4. `order_partially_refunded` в принципе существует как хук, но недоступен как триггер Webhook-фида в UI — если понадобится, только доработкой на стороне FluentCart (правка чужого плагина, вне скоупа).

**Вопросы, которые нужно решить, прежде чем что-то из этого кодировать** — заданы пользователю отдельно, не решались самостоятельно.
