<?php
/**
 * Plugin Name: RentOS — без дат и авторов в разметке
 * Description: Сайт корпоративный, а не блог (решение владельца 2026-08-09): ни дата
 *              публикации, ни автор не должны фигурировать ни на странице, ни в
 *              разметке для поисковика. Yoast добавляет datePublished/dateModified в
 *              узел WebPage всегда, настройкой это не отключается — снимаем фильтром.
 *              Файлы плагинов не трогаются, обновления ничего не сотрут.
 */

// Даты из узла WebPage. Штатный фильтр Yoast, ничего не переопределяем силой.
add_filter('wpseo_schema_webpage', function ($data) {
    unset($data['datePublished'], $data['dateModified']);

    return $data;
}, 20);

/**
 * Пустой автор — хуже отсутствующего.
 *
 * После отключения архивов автора Yoast всё равно оставлял в графе узел Person и
 * ссылку author с пустыми name и @id: для Google это битая разметка Article.
 * Убираем и ссылку, и сам узел; тип записей при этом переведён с Article на None,
 * так что терять нечего.
 */
add_filter('wpseo_schema_graph', function ($graph) {
    if (!is_array($graph)) {
        return $graph;
    }

    $cleaned = [];
    foreach ($graph as $piece) {
        $type = $piece['@type'] ?? '';
        $types = is_array($type) ? $type : [$type];

        // Узел автора выкидываем целиком.
        if (in_array('Person', $types, true)) {
            continue;
        }

        unset($piece['author']);
        if (in_array('WebPage', $types, true) || in_array('CollectionPage', $types, true)) {
            unset($piece['datePublished'], $piece['dateModified']);
        }

        $cleaned[] = $piece;
    }

    return $cleaned;
}, 20);
