<?php
/**
 * Plugin Name: RentOS — шрифт Inter: swap и предзагрузка
 * Description: Две вещи, которых нельзя добиться настройками панели.
 *              1) font-display: swap вместо auto. При auto браузер до трёх секунд
 *              держит текст невидимым, а потом перевёрстывает его — на «Ценах» это
 *              давало сдвиг вёрстки 0.406 (замерено 2026-08-09, порог Google — 0.1).
 *              Со swap текст рисуется сразу запасным шрифтом. У Elementor Pro для
 *              этого есть свой фильтр, файлы плагина не трогаем.
 *              2) Предзагрузка самого файла. Шрифт объявлен в инлайновом <style>,
 *              то есть браузер узнаёт о нём только разобрав половину <head>;
 *              rel=preload в самом начале выносит запрос вперёд.
 *              Своего JS и CSS на сайте нет — это серверная разметка в <head>.
 */

// Inter — единственный шрифт сайта (Poppins убран 2026-08-09).
const RENTOS_FONT_URL = '/wp-content/uploads/2026/07/Inter-VariableFont_opszwght-1.woff2';

add_filter('elementor_pro/custom_fonts/font_display', function () {
    return 'swap';
}, 10);

add_action('wp_head', function () {
    if (is_admin()) {
        return;
    }

    $path = ABSPATH . ltrim(RENTOS_FONT_URL, '/');
    if (!file_exists($path)) {
        return; // файл переименовали — молча не подсовываем битую предзагрузку
    }

    printf(
        '<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
        esc_url(home_url(RENTOS_FONT_URL))
    );
}, 1);
