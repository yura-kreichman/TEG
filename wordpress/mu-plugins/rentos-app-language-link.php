<?php
/**
 * Plugin Name: RentOS — язык при переходе в приложение
 * Description: Дописывает ?lang=xx к ссылкам на my.rentos365.app, чтобы выбранный на сайте язык сохранялся в приложении.
 * Version: 1.0
 *
 * Задача (2026-08-09): посетитель, открывший английскую версию сайта,
 * переходил по кнопке «Попробовать» и попадал на форму регистрации
 * по-русски — приложение о его выборе ничего не знало.
 *
 * Почему фильтром, а не правкой ссылок в меню: у пунктов «Войти» и
 * «Попробовать» в названии лежит HTML-разметка кнопок, и любая правка этих
 * пунктов через API её обнуляет (проверено). Здесь адрес меняется на лету при
 * выводе, сами пункты остаются нетронутыми.
 *
 * Коды языков TranslatePress до символа «_» в точности совпадают с локалями
 * RentOS: ru_RU→ru, en_US→en, uk→uk, it_IT→it, ro_RO→ro. Брать надо именно
 * КОД языка, а не слаг из адреса: у украинского слаг «ua», а локаль в
 * приложении — «uk», и по слагу вышло бы несовпадение.
 *
 * Параметр добавляется всегда, включая русский. Иначе посетитель русской
 * версии с англоязычным браузером получил бы в приложении английский —
 * resolveLocale() без явного указания падает на Accept-Language.
 */

if (!defined('ABSPATH')) {
    exit;
}

const RENTOS_APP_HOST = 'my.rentos365.app';

/** Локали, которые понимает приложение (src/lib/locales.ts). */
const RENTOS_APP_LOCALES = [
    'ru', 'en', 'uk', 'ro', 'be', 'pl', 'it',
    'uz', 'kk', 'tg', 'ky', 'hy', 'az', 'ka', 'tr',
];

/**
 * Текущий язык в виде локали приложения, либо null, если определить не вышло
 * (тогда ссылку не трогаем — пусть приложение решает само).
 */
function rentos_app_current_locale(): ?string
{
    global $TRP_LANGUAGE;

    $language = is_string($TRP_LANGUAGE) && $TRP_LANGUAGE !== '' ? $TRP_LANGUAGE : get_locale();
    if (!is_string($language) || $language === '') {
        return null;
    }

    $locale = strtolower(explode('_', $language)[0]);

    return in_array($locale, RENTOS_APP_LOCALES, true) ? $locale : null;
}

/** Дописывает ?lang= к адресу, если он ведёт в приложение. */
function rentos_app_add_language(string $url): string
{
    if (strpos($url, RENTOS_APP_HOST) === false) {
        return $url;
    }

    // Проверяем именно хост, а не вхождение подстроки: адрес вида
    // https://example.com/?r=my.rentos365.app трогать не надо.
    $host = wp_parse_url($url, PHP_URL_HOST);
    if ($host !== RENTOS_APP_HOST) {
        return $url;
    }

    // Уже указан явно — уважаем, не перебиваем.
    $query = wp_parse_url($url, PHP_URL_QUERY);
    if ($query) {
        parse_str($query, $params);
        if (!empty($params['lang'])) {
            return $url;
        }
    }

    $locale = rentos_app_current_locale();

    return $locale ? add_query_arg('lang', $locale, $url) : $url;
}

// Пункты меню — там сейчас живут обе ссылки на приложение.
add_filter('nav_menu_link_attributes', function ($atts) {
    if (!empty($atts['href'])) {
        $atts['href'] = rentos_app_add_language((string) $atts['href']);
    }
    return $atts;
}, 10, 1);

// Содержимое страниц и виджетов — на случай, если ссылку добавят кнопкой
// Elementor или прямо в тексте. Дешёвая проверка подстрокой до регулярки:
// на страницах без таких ссылок фильтр не делает ничего.
function rentos_app_filter_content($content)
{
    if (!is_string($content) || strpos($content, RENTOS_APP_HOST) === false) {
        return $content;
    }

    return preg_replace_callback(
        '#(href=["\'])([^"\']*' . preg_quote(RENTOS_APP_HOST, '#') . '[^"\']*)(["\'])#i',
        static function ($m) {
            return $m[1] . esc_url(rentos_app_add_language($m[2])) . $m[3];
        },
        $content
    );
}

add_filter('the_content', 'rentos_app_filter_content', 20);
add_filter('widget_text', 'rentos_app_filter_content', 20);
add_filter('elementor/frontend/the_content', 'rentos_app_filter_content', 20);
