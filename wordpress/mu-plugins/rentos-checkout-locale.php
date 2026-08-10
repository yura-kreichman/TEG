<?php
/**
 * Plugin Name: RentOS — язык покупателя в вебхуке FluentCart
 * Description: Кабинет, созданный по факту оплаты, до этого всегда получал язык по умолчанию:
 *              письмо «кабинет готов» уходило на русском кому угодно. Своего поля под язык у
 *              FluentCart нет (order.config перечисляет ключи жёстко, order_meta в тело вебхука
 *              не входит), поэтому язык страницы оформления снимается с Referer в момент
 *              wp_ajax_*_fluent_cart_place_order, на shutdown кладётся в мету заказа (к этому
 *              моменту заказ уже создан и связан с корзиной по cart_hash), а фильтр
 *              fluent_cart/webhook/payload добавляет его в тело вебхука полем rentos_locale.
 *              Приложение читает это поле и ставит Tenant.locale при создании кабинета.
 *              Базовый язык сайта — русский, он без префикса, поэтому он же и запасной вариант.
 */

const RENTOS_ORDER_LOCALE_META = '_rentos_locale';

/**
 * Языки сайта (TranslatePress): базовый ru без префикса, остальные — префиксом пути.
 * Префикс украинского в настройках TranslatePress — ua, а код языка в RentOS — uk;
 * отдаём именно код RentOS, иначе приложение отбросит значение как незнакомое.
 */
function rentos_locale_from_referer(): string
{
    $referer = isset($_SERVER['HTTP_REFERER']) ? esc_url_raw(wp_unslash($_SERVER['HTTP_REFERER'])) : '';
    $path = $referer ? (string) wp_parse_url($referer, PHP_URL_PATH) : '';

    foreach (['en' => 'en', 'ua' => 'uk', 'it' => 'it', 'ro' => 'ro'] as $prefix => $locale) {
        if ($path === '/' . $prefix || str_starts_with($path, '/' . $prefix . '/')) {
            return $locale;
        }
    }

    return 'ru';
}

function rentos_capture_checkout_locale(): void
{
    $hash = isset($_GET['fct_cart_hash']) ? sanitize_text_field(wp_unslash($_GET['fct_cart_hash'])) : '';
    if (!$hash) {
        return;
    }

    $locale = rentos_locale_from_referer();

    // Заказа в этот момент ещё нет — он создаётся внутри обработчика, поэтому запись
    // откладывается до конца того же запроса.
    add_action('shutdown', function () use ($hash, $locale) {
        if (!class_exists('\FluentCart\App\Models\Cart')) {
            return;
        }

        $cart = \FluentCart\App\Models\Cart::query()->where('cart_hash', $hash)->first();
        if (!$cart || empty($cart->order_id)) {
            return;
        }

        \FluentCart\App\Models\OrderMeta::query()->updateOrCreate(
            ['order_id' => $cart->order_id, 'meta_key' => RENTOS_ORDER_LOCALE_META],
            ['meta_value' => $locale]
        );
    });
}

add_action('wp_ajax_fluent_cart_place_order', 'rentos_capture_checkout_locale', 1);
add_action('wp_ajax_nopriv_fluent_cart_place_order', 'rentos_capture_checkout_locale', 1);

add_filter('fluent_cart/webhook/payload', function ($payload, $context) {
    $order = $context['order'] ?? null;
    if (!is_array($payload) || !$order || empty($order->id)) {
        return $payload;
    }

    // У продлений свой заказ-потомок, язык записан на первом (родительском).
    $orderId = !empty($order->parent_id) ? $order->parent_id : $order->id;

    $meta = \FluentCart\App\Models\OrderMeta::query()
        ->where('order_id', $orderId)
        ->where('meta_key', RENTOS_ORDER_LOCALE_META)
        ->first();

    if ($meta && $meta->meta_value) {
        $payload['rentos_locale'] = $meta->meta_value;
    }

    return $payload;
}, 10, 2);
