<?php
/**
 * Plugin Name: RentOS: переводы кабинета FluentCart и Fluent Support
 * Description: Статусы в кабинете FluentCart на языке сайта; наши дополнения переводов из wp-content/languages/loco/plugins/ работают и без Loco Translate.
 *
 * 1. Кабинет FluentCart (с версии 2.2) подписывает статусы заказов и подписок
 *    через собственный список строк fluentcart_customer_profile_vars.trans:
 *    Badge берёт английскую подпись из словаря статусов (completed → "Completed")
 *    и ищет её в этом списке. Слов статусов в списке нет, поэтому на всех языках
 *    висели "Completed", "Active", "Paid", хотя в языковых пакетах они переведены.
 *    Дописываем их штатным фильтром fluent_cart/customer_profile_translations.
 *    Ключ, который плагин когда-нибудь добавит сам, не трогаем.
 *
 * 2. Дополнения к переводам (русские строки новых версий, частичные uk/it/ro)
 *    лежат в wp-content/languages/loco/plugins/. Эту папку подключает Loco
 *    Translate, и она не стирается обновлениями плагинов и языковых пакетов.
 *    Если Loco выключат, подгружаем те же файлы сами, раньше официального пакета,
 *    чтобы наши строки по-прежнему имели приоритет.
 *
 * Копия в репозитории: wordpress/mu-plugins/rentos-fluent-cart-i18n.php
 */

defined('ABSPATH') || exit;

add_filter('fluent_cart/customer_profile_translations', function ($translations) {
    if (!is_array($translations)) {
        return $translations;
    }

    // Подписи из словаря статусов в assets/Start7.js (объект с completed:"Completed").
    $labels = [
        'Completed'      => __('Completed', 'fluent-cart'),
        'Paid'           => __('Paid', 'fluent-cart'),
        'Active'         => __('Active', 'fluent-cart'),
        'Published'      => __('Published', 'fluent-cart'),
        'Draft'          => __('Draft', 'fluent-cart'),
        'Shipped'        => __('Shipped', 'fluent-cart'),
        'Success'        => __('Success', 'fluent-cart'),
        'Licensed'       => __('Licensed', 'fluent-cart'),
        'Succeeded'      => __('Succeeded', 'fluent-cart'),
        'Failed'         => __('Failed', 'fluent-cart'),
        'Error'          => __('Error', 'fluent-cart'),
        'Canceled'       => __('Canceled', 'fluent-cart'),
        'Expired'        => __('Expired', 'fluent-cart'),
        'Partially Paid' => __('Partially Paid', 'fluent-cart'),
        'Intended'       => __('Intended', 'fluent-cart'),
        'Scheduled'      => __('Scheduled', 'fluent-cart'),
        'On Hold'        => __('On Hold', 'fluent-cart'),
        'Pending'        => __('Pending', 'fluent-cart'),
        'Unpaid'         => __('Unpaid', 'fluent-cart'),
        'Warning'        => __('Warning', 'fluent-cart'),
        'Processing'     => __('Processing', 'fluent-cart'),
        'Future'         => __('Future', 'fluent-cart'),
        'Inactive'       => __('Inactive', 'fluent-cart'),
        'Dispute'        => __('Dispute', 'fluent-cart'),
        'Disabled'       => __('Disabled', 'fluent-cart'),
        'Beta'           => __('Beta', 'fluent-cart'),
        'Subscription'   => __('Subscription', 'fluent-cart'),
        'Renewal'        => __('Renewal', 'fluent-cart'),
        'Payment'        => __('Payment', 'fluent-cart'),
        'Unshipped'      => __('Unshipped', 'fluent-cart'),
        'Trialing'       => __('Trialing', 'fluent-cart'),
    ];

    foreach ($labels as $key => $text) {
        if (!isset($translations[$key])) {
            $translations[$key] = $text;
        }
    }

    return $translations;
});

add_action('load_textdomain', function ($domain, $mofile) {
    static $busy = false;

    // Loco сам грузит свою папку первой, второй раз не нужно.
    if ($busy || function_exists('loco_plugin_self')) {
        return;
    }
    if (!in_array($domain, ['fluent-cart', 'fluent-support', 'fluent-security'], true)) {
        return;
    }

    $custom = WP_LANG_DIR . '/loco/plugins/' . basename((string) $mofile);
    if ($custom === $mofile || !is_readable($custom)) {
        return;
    }

    $busy = true;
    load_textdomain($domain, $custom);
    $busy = false;
}, 10, 2);
