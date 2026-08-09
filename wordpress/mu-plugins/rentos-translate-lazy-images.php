<?php
/**
 * Plugin Name: RentOS — переводить адрес картинки в атрибутах ленивой загрузки
 * Description: На «Возможностях» для en/it/ro подложены англоязычные скриншоты:
 *              в словаре TranslatePress лежат пары «адрес русского файла → адрес
 *              английского». Но WP Rocket с ленивой загрузкой уносит настоящий
 *              адрес в `data-lazy-src`, оставляя в `src` заглушку, а TP этот
 *              атрибут не знает — и при прокрутке на английской странице
 *              подгружались русские снимки (18 картинок, найдено 2026-08-09).
 *
 *              Тот же приём уже применён к `data-src` (карусели Elementor) —
 *              см. `trp_node_accessors` в снippете rentos-sso. Здесь отдельный
 *              файл, чтобы не переписывать снippet целиком: у FluentSnippets
 *              обновление идёт только через свой Helper, и цена ошибки высокая.
 */

add_filter('trp_node_accessors', function ($accessors) {
    if (!is_array($accessors)) {
        return $accessors;
    }

    $accessors['image_lazy_src'] = [
        'selector'  => 'img[data-lazy-src]',
        'accessor'  => 'data-lazy-src',
        'attribute' => true,
    ];
    // Набор размеров у ленивой загрузки тоже свой: без него браузер может выбрать
    // из srcset русский файл, хотя в src уже английский.
    $accessors['image_lazy_srcset'] = [
        'selector'  => 'img[data-lazy-srcset]',
        'accessor'  => 'data-lazy-srcset',
        'attribute' => true,
    ];

    return $accessors;
}, 20);
