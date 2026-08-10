<?php
/**
 * Plugin Name: RentOS — кабинет покупателя в вебхуке FluentCart
 * Description: Единственной связью между оплатой и кабинетом в RentOS был email покупателя.
 *              Владелец, заведший кабинет на личный адрес, но оплативший с адреса бухгалтерии,
 *              получал ВТОРОЙ, пустой кабинет с активной подпиской, а настроенный оставался на
 *              Free и попадал под автоудаление брошенных — человек платил и терял данные.
 *              Приложение теперь добавляет к ссылке «Управлять подпиской» подписанный
 *              идентификатор кабинета (?rentos_tid=…, подпись проверяет только RentOS, сайту
 *              секрет не нужен). Плагин запоминает его в cookie на входе, на
 *              wp_ajax_*_fluent_cart_place_order кладёт в мету заказа (тем же приёмом с
 *              cart_hash и shutdown, что и rentos-checkout-locale.php — заказа в момент
 *              вызова ещё нет), а фильтр fluent_cart/webhook/payload возвращает его полем
 *              rentos_tid. Вебхук RentOS ищет тенанта по нему раньше, чем по email.
 *              Токена нет (холодная покупка с сайта, автопродление) — всё работает как раньше.
 */

const RENTOS_ORDER_TENANT_META = '_rentos_tid';

// Одно и то же имя у query-параметра ссылки и у cookie — оно же приходит в
// payload вебхука (BILLING_TOKEN_PARAM в src/lib/billing.ts). Одно слово на все
// три системы, чтобы связь находилась грепом.
const RENTOS_TENANT_PARAM = 'rentos_tid';

// 30 дней — ровно столько же живёт сам токен в приложении (BILLING_TOKEN_TTL_MS,
// src/lib/billing-token.ts): держать cookie дольше незачем, просроченный токен
// приложение всё равно отвергнет и вернётся к поиску по email. Число литералом,
// а не 30 * DAY_IN_SECONDS: константа WordPress объявлена через define(), и
// полагаться на её доступность в константном выражении на этапе разбора файла
// не стоит.
const RENTOS_TENANT_COOKIE_TTL = 2592000;

/**
 * Формат токена — `billing_<id>.<срок>.<подпись base64url>`. Проверяем только
 * алфавит и длину: подпись сайту проверять нечем и незачем, это делает RentOS.
 * Смысл проверки — не занести в базу мусор из случайного чужого параметра.
 */
function rentos_is_valid_tenant_token(string $value): bool
{
    return (bool) preg_match('/^[A-Za-z0-9_.\-]{20,400}$/', $value);
}

function rentos_tenant_token_from_request(): string
{
    // Порядок: свежий параметр ссылки важнее cookie от прошлого визита — человек
    // мог сменить кабинет (у одного владельца их бывает несколько).
    $sources = [];

    if (isset($_GET[RENTOS_TENANT_PARAM])) {
        $sources[] = sanitize_text_field(wp_unslash($_GET[RENTOS_TENANT_PARAM]));
    }

    // Запасной путь для запроса place_order: он уходит на admin-ajax.php, своего
    // query-параметра у него нет, но Referer — это страница оформления, и если
    // человек попал на неё прямо по ссылке из кабинета, токен лежит там.
    if (isset($_SERVER['HTTP_REFERER'])) {
        $query = (string) wp_parse_url(esc_url_raw(wp_unslash($_SERVER['HTTP_REFERER'])), PHP_URL_QUERY);
        parse_str($query, $params);
        if (!empty($params[RENTOS_TENANT_PARAM])) {
            $sources[] = sanitize_text_field($params[RENTOS_TENANT_PARAM]);
        }
    }

    if (isset($_COOKIE[RENTOS_TENANT_PARAM])) {
        $sources[] = sanitize_text_field(wp_unslash($_COOKIE[RENTOS_TENANT_PARAM]));
    }

    foreach ($sources as $candidate) {
        if ($candidate && rentos_is_valid_tenant_token($candidate)) {
            return $candidate;
        }
    }

    return '';
}

/**
 * Переход по ссылке из кабинета: запоминаем токен, чтобы он пережил дорогу от
 * страницы цен до оформления заказа.
 *
 * WP Rocket страницы с query-строкой не кеширует, поэтому PHP здесь реально
 * отрабатывает; на самой странице цен без параметра ничего не происходит и её
 * кеш не страдает.
 */
function rentos_capture_tenant_token(): void
{
    if (!isset($_GET[RENTOS_TENANT_PARAM]) || headers_sent()) {
        return;
    }

    $token = sanitize_text_field(wp_unslash($_GET[RENTOS_TENANT_PARAM]));
    if (!$token || !rentos_is_valid_tenant_token($token)) {
        return;
    }

    setcookie(RENTOS_TENANT_PARAM, $token, [
        'expires' => time() + RENTOS_TENANT_COOKIE_TTL,
        'path' => '/',
        'secure' => is_ssl(),
        // Читает cookie только PHP этого же сайта — JS доступ не нужен.
        'httponly' => true,
        // Lax, а не Strict: человек приходит по внешней ссылке из приложения,
        // при Strict cookie не поставилась бы ровно в этом сценарии.
        'samesite' => 'Lax',
    ]);
}

add_action('init', 'rentos_capture_tenant_token');

/**
 * Оформление заказа: заказа в этот момент ещё нет, он создаётся внутри
 * обработчика — поэтому запись в мету откладывается до конца того же запроса и
 * находит заказ по cart_hash. Тот же приём, что в rentos-checkout-locale.php.
 */
function rentos_attach_tenant_token_to_order(): void
{
    $hash = isset($_GET['fct_cart_hash']) ? sanitize_text_field(wp_unslash($_GET['fct_cart_hash'])) : '';
    if (!$hash) {
        return;
    }

    $token = rentos_tenant_token_from_request();
    if (!$token) {
        return;
    }

    add_action('shutdown', function () use ($hash, $token) {
        if (!class_exists('\FluentCart\App\Models\Cart')) {
            return;
        }

        $cart = \FluentCart\App\Models\Cart::query()->where('cart_hash', $hash)->first();
        if (!$cart || empty($cart->order_id)) {
            return;
        }

        \FluentCart\App\Models\OrderMeta::query()->updateOrCreate(
            ['order_id' => $cart->order_id, 'meta_key' => RENTOS_ORDER_TENANT_META],
            ['meta_value' => $token]
        );
    });
}

add_action('wp_ajax_fluent_cart_place_order', 'rentos_attach_tenant_token_to_order', 1);
add_action('wp_ajax_nopriv_fluent_cart_place_order', 'rentos_attach_tenant_token_to_order', 1);

add_filter('fluent_cart/webhook/payload', function ($payload, $context) {
    $order = $context['order'] ?? null;
    if (!is_array($payload) || !$order || empty($order->id)) {
        return $payload;
    }

    // У продлений свой заказ-потомок, токен записан на первом (родительском) —
    // именно поэтому автопродление тоже попадёт в нужный кабинет, хотя по самому
    // продлению человек никуда не ходил.
    $orderId = !empty($order->parent_id) ? $order->parent_id : $order->id;

    $meta = \FluentCart\App\Models\OrderMeta::query()
        ->where('order_id', $orderId)
        ->where('meta_key', RENTOS_ORDER_TENANT_META)
        ->first();

    if ($meta && $meta->meta_value) {
        $payload['rentos_tid'] = $meta->meta_value;
    }

    return $payload;
}, 10, 2);
