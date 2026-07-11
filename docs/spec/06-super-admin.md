# Модуль Super Admin

Внутренний операционный инструмент (не клиентский продукт) — панель владельца платформы, отделённая от кабинетов тенантов. Не применяет Airbnb-стиль дизайн-системы из `03-design-system.md` — чистый функциональный shadcn/ui без лишней стилизации, приоритет скорости и ясности, не эстетики.

## Отличия от первоначального ТЗ (согласовано с пользователем 2026-07-11)

ТЗ изначально описывало отдельную таблицу `AdminUser` (login+пароль, без email) с полностью изолированной auth-моделью. В проекте уже была рабочая реализация — `User.role = super_admin` на той же таблице, что и Owner, но с отдельным cookie (`admin_session`), отдельным роутом `/api/auth/admin/login` и отдельным guard'ом `requireSuperAdmin()`. Заводить `AdminUser` означало бы сломать уже существующий реальный аккаунт и требовало миграции без явной пользы (изоляция сессии уже есть). Решение: оставить `User`+`role`, только ужесточить таймаут сессии до значения из ТЗ (2 часа).

Модели `Plan`/`Tenant.planId` из ТЗ переименованы обратно в уже принятые в проекте `Package`/`Tenant.packageId` (ТЗ явно разрешает адаптацию имён под конвенции проекта). `Tenant.status` (строка) не заводился отдельно — переиспользован существующий `Tenant.subscriptionStatus` (enum), в него добавлено значение `suspended` (админский ручной оверрайд из-за проблем с оплатой) — отдельно от уже существующего `paused` (сезонная пауза, инициируется самим владельцем, docs/spec/00-architecture.md). Лимиты пакета в проекте — `maxPoints`/`maxZones`/`maxAssets`/`maxOperators` (4 поля, не 3 — в проекте есть отдельный лимит на зоны), оставлены как есть.

**Важно, ранее записанное решение отменяется этим ТЗ:** `00-architecture.md`/схема ранее фиксировали "нет реального биллинга... план+лимиты без денег" (2026-07-10) — этот модуль вводит реальную интеграцию с FluentCart (вебхуки, привязка тенанта к клиенту/продукту).

**Ручной оверрайд статуса убран (фидбек пользователя 2026-07-11): "Оверрайд статуса вообще не нужен".** Отдельного объекта `manualStatusOverride` ({active, reason, setAt, by}) больше нет — ни поля в схеме, ни карточки в UI, ни проверки в вебхуке. Super Admin ставит `Tenant.subscriptionStatus` напрямую через селект на `/admin/tenants/[id]` (тот же селект, что и всегда там был); статус остаётся, пока его не сменит следующий подходящий вебхук FluentCart или сам админ вручную — приоритета "ручное над автоматическим" больше нет, это осознанное упрощение. `suspended` как значение статуса остаётся (админ ставит его напрямую вместо активного).

## 1. Модель доступа

- `User.role = super_admin` (см. выше) — один аккаунт на этом этапе, UI управления ролями не нужен.
- Вход по `/api/auth/admin/login` (**логин** + пароль, поле `User.login`, не email — фидбек пользователя 2026-07-12: "у меня вообще нет логина и пароля... не email а именно логин и пароль") — не переиспользует `/api/auth/login`.
- Cookie `admin_session`, отдельная от Owner. Таймаут — 2 часа (короче, чем у Owner), срок зашит в сам подписываемый токен (`signExpiringToken`/`verifyExpiringToken`, src/lib/session-crypto.ts), а не только в cookie maxAge — иначе перехваченное значение cookie было бы валидно вечно при прямом реплее.
- `requireSuperAdmin()` — отдельный guard, используется во всех `/admin/*` страницах и `/api/admin/*` роутах.
- Аккаунт создаётся/чинится через `npm run admin:seed` (читает `ADMIN_LOGIN`/`ADMIN_PASSWORD` из `.env`, идемпотентен — обновляет существующий `role=super_admin`, а не плодит второй) и `npm run admin:reset-password` (перечитывает `ADMIN_PASSWORD`). Скрипты — `scripts/admin-seed.ts`/`scripts/admin-reset-password.ts`, запускаются через `tsx` (обычный `node` не резолвит сгенерированный Prisma-клиент — там бандлерное разрешение путей без расширений).

## 2. Создание аккаунта администратора

Без формы регистрации в проде. Аккаунт создаётся вручную (сейчас) — сидер `admin:seed`/`admin:reset-password` из ТЗ не заводился, т.к. это уже другая auth-модель (User, не AdminUser); при необходимости создать второй платформенный аккаунт — вручную через Prisma Studio/psql либо через `/register`+ручную смену role в БД.

## 3. Схема данных (Prisma) — фактическая

```prisma
enum SubscriptionStatus {
  trialing
  active
  paused    // сезонная пауза, инициирует Owner
  suspended // ручной оверрайд Super Admin (проблемы с оплатой и т.п.)
  expired
}

model Package {
  // ...существующие поля...
  fluentcartProductId String? @unique
}

model Tenant {
  // ...существующие поля...
  fluentcartCustomerId String?             @unique
  limitOverrides       Json? // { maxPoints?, maxZones?, maxAssets?, maxOperators? }
}

model WebhookEvent {
  id         String   @id @default(cuid())
  provider   String   // "fluentcart"
  eventType  String
  payload    Json
  status     String   // "processed" | "failed"
  error      String?
  receivedAt DateTime @default(now())
}

model SystemSettings {
  id     String @id @default("singleton")
  // { telegramBotToken, smtp: {...} } — без defaultLocale/defaultTimezone/
  // defaultCurrency: убраны по фидбеку пользователя 2026-07-12, "они сами
  // себе их задают" — locale определяется при регистрации (resolveLocale()),
  // timezone — по браузеру при регистрации (см. /api/auth/register).
  config Json
}
```

## 4. UI-страницы

Как в исходном ТЗ (см. ниже, раздел "Исходное ТЗ"), с поправкой на реальные имена полей/моделей выше.

## 5. Эндпоинт вебхуков FluentCart

`POST /api/webhooks/fluentcart`. Каждое активирующее/истекающее событие безусловно обновляет `Tenant.subscriptionStatus` — ручного оверрайда, имеющего приоритет, больше нет (убран, см. "Отличия от первоначального ТЗ" выше). Тенант НЕ создаётся автоматически (доп. инструкция "связывание тенанта с FluentCart", 2026-07-12) — порядок поиска: `fluentcartCustomerId` → email владельца (`User.role=owner`) → не найден (пишем `WebhookEvent.status="failed"`, 200, чтобы FluentCart не ретраил).

**Реальная структура payload** — сверена с исходниками плагина (пользователь предоставил исходники free+Pro в `FluentCart/` в корне репозитория, 2026-07-12), не гипотеза:

Источник — `fluent-cart-pro/app/Modules/Integrations/WebhookConnect.php` (интеграция "Webhook", режим "All Data"):

```json
{
  "order": { "id": 1, "customer_id": 1, "status": "...", "payment_status": "paid", "type": "subscription", ... },
  "customer": { "id": 1, "email": "...", "first_name": "...", "last_name": "...", ... },
  "transactions": [ ... ],
  "order_items": [ { "post_id": 123, "object_id": ..., "title": "...", ... } ],
  "subscriptions": [ { "product_id": 123, "expire_at": "...", "canceled_at": "...", ... } ],
  "tax_rates": [ ... ],
  "shipping_address": { ... },
  "billing_address": { ... },
  "licenses": [ ... ]
}
```

- `customer.email`/`customer.id` — `FluentCart\App\Models\Customer` (fillable).
- `order.customer_id` — `FluentCart\App\Models\Order`.
- `order_items[].post_id` и `subscriptions[].product_id` — оба ссылаются на WP post ID товара; парсер собирает оба списка и ищет `Package` по первому совпадению с `fluentcartProductId`.

**Важное ограничение, найденное в исходниках:** сам payload НЕ содержит имя сработавшего события (`order_paid_done`, `subscription_renewed` и т.п.) — это внутренний `$hook` (`IntegrationEventListener.php`, `$integrationArray['trigger']`), который `WebhookConnect::processAction()` не сериализует в тело запроса. Единственный способ получить событие без правки PHP-кода плагина — завести в админке FluentCart **отдельный "Webhook"-фид на каждое нужное событие** (поле "Event Trigger" в настройках фида) и прописать имя события статическим кастомным заголовком (Request Headers → "With Headers"), например `X-FluentCart-Event: order_paid_done`. Секрет — туда же вторым заголовком (`X-FluentCart-Webhook-Secret`, сравнивается с `FLUENTCART_WEBHOOK_SECRET` из `.env`). Роут читает оба из заголовков (event — с фоллбэком на query-параметр `?event=`, на случай упрощённой ручной настройки).

Названия событий — дословно из `FluentCart\App\Helpers\Status::eventTriggers()`:
- Активирующие статус (`subscriptionStatus = "active"`): `order_paid_done`, `subscription_activated`, `subscription_reactivated`, `subscription_renewed`.
- Переводящие в `expired`: `subscription_canceled`, `subscription_eot`, `subscription_expired_validity`, `order_status_changed_to_canceled`, `order_fully_refunded`.
- Не используются модулем (доставка): `shipping_status_changed_to_shipped`, `shipping_status_changed_to_delivered`.

## 6. Проверка лимитов

`getTenantLimits(tenantId)` в `src/lib/packages.ts` — эффективные лимиты: `Tenant.limitOverrides` поверх `Tenant.package` (4 поля: maxPoints/maxZones/maxAssets/maxOperators). Существующий `checkPackageLimit()` переведён на эту функцию, чтобы оверрайд реально применялся при проверках, а не только хранился.

Эффективный лимит (с учётом оверрайда) виден и владельцу, и админу, не только хранится — фидбек пользователя 2026-07-11. На карточке "Ваш план" (`/`, `dashboard-home.tsx`) владелец видит `used / effectiveMax`. На карточке "Использование" (`/admin/tenants/[id]`) админ видит `used / effectiveMax` плюс дельту оверрайда рядом (`+N` зелёным, если `limitOverrides[key]` больше значения пакета) — раньше там ошибочно показывался голый `package.maxPoints` без учёта оверрайда, что расходилось с тем, что видел владелец.

## Вне скоупа

Ролевая модель/несколько админов, audit log действий администратора, feature flags, UI-лог вебхуков с ресинком, дашборд здоровья платформы, поиск/фильтры в списке тенантов, 2FA.

## Приоритет реализации

1. Схема данных + миграции
2. Auth: ужесточить таймаут сессии
3. Эндпоинт вебхука + логика синхронизации статуса
4. `/admin/tenants` + карточка тенанта (ручные оверрайды + impersonate)
5. `/admin/plans` (существующий `/admin/packages`, добавить `fluentcartProductId`)
6. `/admin/settings`

---

## Исходное ТЗ (дословно, для сверки)

### 4. UI-страницы

**`/admin/login`**
- Форма: логин, пароль
- Без "запомнить меня", без соцавторизации

**`/admin/tenants`**
- Простой список всех тенантов: название, план, статус, дата регистрации
- Без поиска/фильтров в MVP — просто таблица целиком
- Клик по строке → карточка тенанта

**`/admin/tenants/[id]`**
- Основные данные тенанта + текущий план
- История событий биллинга (последние обработанные webhook-события для этого тенанта, read-only, из таблицы `WebhookEvent` отфильтрованные по `fluentcartCustomerId`)
- Форма ручного оверрайда статуса: переключатель active/suspended + поле "причина" (сохраняется в `manualStatusOverride`)
- Форма ручного оверрайда лимитов: опциональные поля лимитов, которые перекрывают значения из плана (сохраняются в `limitOverrides`)
- Кнопка "Impersonate" — создаёт временную сессию от имени владельца этого тенанта и редиректит в его кабинет; в UI кабинета тенанта в этом режиме должен быть явный баннер "Вы вошли как администратор от имени {tenant.name}" с кнопкой выхода из режима имперсонации

**`/admin/plans`**
- Список планов
- CRUD: название, `fluentcartProductId`, лимиты, `priceNote`/`priceMonthly`

**`/admin/settings`**
- Форма глобальных настроек: токен Telegram-бота, SMTP (host/port/user/password/from), дефолтная локаль/таймзона/валюта
- Сохраняется в единственную запись `SystemSettings`

### 5. Эндпоинт приёма вебхуков FluentCart

`POST /api/webhooks/fluentcart`

- Проверка заголовка с секретом (сравнить с значением из `.env`, например `FLUENTCART_WEBHOOK_SECRET`) — если не совпадает, вернуть 401 и не обрабатывать
- Сохранить сырой payload в `WebhookEvent` независимо от исхода обработки
- Распарсить `product_id`/`customer_id`/тип события из payload FluentCart
- Найти `Package` по `fluentcartProductId`, найти или создать `Tenant` по `fluentcartCustomerId`
- В зависимости от типа события (`order.completed`, `subscription.created/renewed` → активировать; `subscription.cancelled/expired` → перевести в `expired`, если нет активного `manualStatusOverride`) — обновить `Tenant.subscriptionStatus` и `Tenant.packageId`
- **Важно:** если у тенанта установлен `manualStatusOverride`, webhook НЕ должен автоматически менять статус — ручной оверрайд имеет приоритет. Логировать это в `WebhookEvent.error` как информационную пометку ("skipped: manual override active"), не как ошибку
- Ответ 200 при успешной обработке, 500 при внутренней ошибке (с логированием в `WebhookEvent.status = "failed"`)
