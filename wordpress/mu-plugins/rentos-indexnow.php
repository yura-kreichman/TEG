<?php
/**
 * Plugin Name: RentOS: IndexNow для Bing и Яндекса
 * Description: Сообщает поисковикам с протоколом IndexNow (Bing, Яндекс, Seznam, Naver) об
 *              опубликованных и изменённых страницах сразу, на всех пяти языках сайта.
 *
 * Зачем свой код. В опциях Yoast стоит enable_index_now = true, но в бесплатном Yoast кода
 * IndexNow нет вообще (это функция Premium): файл ключа отдавал 404, ни одного уведомления не
 * уходило. На 2026-10-18 Bing не знал о сайте ничего (по «rentos365.app» и «RentOS 365» пусто),
 * хотя Google держал в индексе 684 адреса из 730.
 *
 * Ключ лежит физическим файлом в корне сайта: /<RENTOS_INDEXNOW_KEY>.txt, содержимое равно
 * самому ключу. Меняешь ключ здесь — переименуй и файл, иначе поисковики отклонят уведомления
 * (ответ 403).
 *
 * Уведомление уходит не в момент сохранения, а через минуту заданием WP-Cron: правка в
 * редакторе не ждёт внешнего запроса, а несколько сохранений подряд уходят одним списком.
 * Страницы с noindex в Yoast не отправляются. Адреса переводов берёт TranslatePress, с учётом
 * переведённых слагов.
 *
 * Последняя отправка видна в опции rentos_indexnow_last (время, число адресов, код ответа).
 * Коды IndexNow: 200 и 202 означают «принято».
 *
 * Копия в репозитории: wordpress/mu-plugins/rentos-indexnow.php
 */

defined('ABSPATH') || exit;

const RENTOS_INDEXNOW_KEY = '1e0933d34d0149bc957b25db23b2cb68';
const RENTOS_INDEXNOW_HOST = 'rentos365.app';
const RENTOS_INDEXNOW_TYPES = ['post', 'page', 'docs'];

/**
 * Адрес записи на всех опубликованных языках TranslatePress.
 */
function rentos_indexnow_post_urls($rentosPostId) {
    $rentosUrl = get_permalink($rentosPostId);
    if (!$rentosUrl) {
        return [];
    }
    $rentosUrls = [$rentosUrl];

    if (class_exists('TRP_Translate_Press')) {
        $rentosSettings = get_option('trp_settings');
        $rentosConverter = TRP_Translate_Press::get_trp_instance()->get_component('url_converter');
        if (is_array($rentosSettings) && $rentosConverter && method_exists($rentosConverter, 'get_url_for_language')) {
            foreach ((array) ($rentosSettings['publish-languages'] ?? []) as $rentosLocale) {
                if ($rentosLocale === ($rentosSettings['default-language'] ?? '')) {
                    continue;
                }
                $rentosTranslated = $rentosConverter->get_url_for_language($rentosLocale, $rentosUrl, '');
                if (is_string($rentosTranslated) && $rentosTranslated !== '') {
                    $rentosUrls[] = $rentosTranslated;
                }
            }
        }
    }

    return $rentosUrls;
}

/**
 * Отправка списка адресов. Возвращает код ответа (0, если запрос не ушёл).
 */
function rentos_indexnow_submit(array $rentosUrls) {
    // Только боевой сайт: на копии адреса были бы чужими для ключа.
    if (wp_parse_url((string) get_option('home'), PHP_URL_HOST) !== RENTOS_INDEXNOW_HOST) {
        return 0;
    }

    $rentosPrefix = 'https://' . RENTOS_INDEXNOW_HOST . '/';
    $rentosUrls = array_values(array_unique(array_filter($rentosUrls, function ($rentosUrl) use ($rentosPrefix) {
        return is_string($rentosUrl) && strpos($rentosUrl, $rentosPrefix) === 0;
    })));
    if (!$rentosUrls) {
        return 0;
    }

    $rentosCode = 0;
    // Протокол принимает до 10 000 адресов за раз, у нас их сотни.
    foreach (array_chunk($rentosUrls, 9000) as $rentosChunk) {
        $rentosResponse = wp_remote_post('https://api.indexnow.org/indexnow', [
            'timeout' => 15,
            'headers' => ['Content-Type' => 'application/json; charset=utf-8'],
            'body' => wp_json_encode([
                'host' => RENTOS_INDEXNOW_HOST,
                'key' => RENTOS_INDEXNOW_KEY,
                'keyLocation' => $rentosPrefix . RENTOS_INDEXNOW_KEY . '.txt',
                'urlList' => $rentosChunk,
            ]),
        ]);
        $rentosCode = is_wp_error($rentosResponse) ? 0 : (int) wp_remote_retrieve_response_code($rentosResponse);
    }

    update_option('rentos_indexnow_last', [
        'time' => gmdate('c'),
        'count' => count($rentosUrls),
        'code' => $rentosCode,
        'first' => $rentosUrls[0],
    ], false);

    return $rentosCode;
}

add_action('transition_post_status', function ($rentosNew, $rentosOld, $rentosPost) {
    if (!in_array($rentosPost->post_type, RENTOS_INDEXNOW_TYPES, true)) {
        return;
    }
    if ($rentosNew !== 'publish' || wp_is_post_revision($rentosPost) || wp_is_post_autosave($rentosPost)) {
        return;
    }

    $rentosQueue = (array) get_option('rentos_indexnow_queue', []);
    $rentosQueue[] = (int) $rentosPost->ID;
    update_option('rentos_indexnow_queue', array_values(array_unique($rentosQueue)), false);

    if (!wp_next_scheduled('rentos_indexnow_flush')) {
        wp_schedule_single_event(time() + MINUTE_IN_SECONDS, 'rentos_indexnow_flush');
    }
}, 10, 3);

add_action('rentos_indexnow_flush', function () {
    $rentosQueue = (array) get_option('rentos_indexnow_queue', []);
    delete_option('rentos_indexnow_queue');

    $rentosUrls = [];
    foreach ($rentosQueue as $rentosPostId) {
        if (get_post_status($rentosPostId) !== 'publish') {
            continue;
        }
        if (get_post_meta($rentosPostId, '_yoast_wpseo_meta-robots-noindex', true) === '1') {
            continue;
        }
        $rentosUrls = array_merge($rentosUrls, rentos_indexnow_post_urls($rentosPostId));
    }

    rentos_indexnow_submit($rentosUrls);
});
