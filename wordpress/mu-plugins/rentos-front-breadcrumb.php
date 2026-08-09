<?php
/**
 * Plugin Name: RentOS — без хлебных крошек на главной
 * Description: На главной Yoast выводит BreadcrumbList из одного элемента «Главная»
 *              без ссылки, и Search Console отчитывается ошибкой «Отсутствует поле
 *              itemListElement». Крошки из одного пункта смысла не несут: главная и
 *              есть корень пути. Снимаем и сам блок, и ссылку на него из узла
 *              страницы — иначе остаётся указатель в пустоту, что хуже исходного.
 *              На остальных страницах крошки не трогаем, там они полноценные.
 *
 *              Восстановлено 2026-08-09: правка уже делалась раньше, но файла
 *              на сервере не оказалось, а ошибка вернулась. Копия лежит в
 *              репозитории приложения, чтобы больше не терялась.
 */

add_filter('wpseo_schema_graph_pieces', function ($pieces) {
    if (!is_front_page()) {
        return $pieces;
    }

    return array_values(array_filter($pieces, function ($piece) {
        return !($piece instanceof \Yoast\WP\SEO\Generators\Schema\Breadcrumb);
    }));
}, 20);

add_filter('wpseo_schema_webpage', function ($data) {
    if (is_front_page()) {
        unset($data['breadcrumb']);
    }

    return $data;
}, 30);
