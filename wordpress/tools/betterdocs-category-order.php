<?php
/**
 * Порядок РУБРИК на витрине /docs/ — по актуальности.
 *
 * ЧЕМ НА САМОМ ДЕЛЕ ЗАДАЁТСЯ ПОРЯДОК (разбор 2026-09-01, три ложных следа).
 *
 * Витрина /docs/ — страница 64, и рубрики на ней рисует ВИДЖЕТ Elementor
 * `betterdocs-category-grid`, а не шорткод. У виджета своя настройка запроса,
 * и она перебивает настройки плагина. В ней стоит `"orderby":"term_group"` —
 * то есть сортировка идёт по служебной колонке `term_group` таблицы
 * `wp_terms`, а НЕ по мете.
 *
 * У всех одиннадцати рубрик `term_group` был равен нулю, поэтому порядок
 * определялся тем, что вернула база: на витрине первыми оказывались Товары,
 * а «Начало работы» — седьмой.
 *
 * Ложные следы, на которые ушло время (не повторять):
 *  - `doc_category_order` — заполнен верно у всех одиннадцати, но витрина его
 *    не читает;
 *  - `betterdocs_order` — на него указывает настройка плагина
 *    (`terms_orderby = betterdocs_order`), но настройка виджета сильнее;
 *    заполнение этой меты порядок на странице НЕ изменило, проверено.
 *
 * Поэтому скрипт пишет ТРИ поля сразу: `term_group` (по нему сортирует
 * виджет прямо сейчас) плюс обе меты — чтобы порядок не развалился, если
 * виджет когда-нибудь переключат на сортировку по мете.
 *
 * Запуск:
 *   php /tmp/betterdocs-category-order.php          — предпросмотр
 *   php /tmp/betterdocs-category-order.php --apply  — записать
 */

require_once "/var/www/md33/data/www/rentos365.app/wp-load.php";

global $wpdb;

$apply = in_array("--apply", $argv, true);

// Порядок по актуальности для владельца: сначала то, без чего не начать и что
// открывают каждый день, потом подключаемые модули, справочник — последним.
$order = [
    6  => 1,  // Начало работы   — с этого начинают все
    16 => 2,  // Режимы учёта    — ядро: как зона считает деньги
    17 => 3,  // Деньги          — касса, инкассации, расходы
    24 => 4,  // Отчёты          — ради них всё и считается
    18 => 5,  // Рабочее время   — смены и расчёты с сотрудниками
    20 => 6,  // Товары          — модуль, используется часто
    21 => 7,  // Абонементы      — модуль, используется часто
    23 => 8,  // Задачи          — модуль по желанию
    19 => 9,  // Инструктажи     — модуль по желанию
    22 => 10, // Лендинг         — модуль по желанию
    26 => 11, // Настройки       — справочник, открывают по случаю
];

$terms = get_terms(["taxonomy" => "doc_category", "hide_empty" => false]);
if (is_wp_error($terms)) {
    fwrite(STDERR, "Не удалось получить рубрики\n");
    exit(1);
}

// Проверка: список должен покрывать ВСЕ рубрики, иначе снова получим дыры.
$missing = [];
foreach ($terms as $term) {
    if (!isset($order[$term->term_id])) {
        $missing[] = "{$term->term_id} ({$term->name})";
    }
}
if ($missing) {
    fwrite(STDERR, "В списке нет рубрик: " . implode(", ", $missing) . " — ничего не записано\n");
    exit(1);
}

$changed = 0;
foreach ($order as $termId => $position) {
    $term = get_term($termId, "doc_category");
    if (!$term || is_wp_error($term)) {
        fwrite(STDERR, "term {$termId}: НЕ НАЙДЕН — ничего не записано\n");
        exit(1);
    }

    $currentBd    = get_term_meta($termId, "betterdocs_order", true);
    $currentDoc   = get_term_meta($termId, "doc_category_order", true);
    $currentGroup = (int) $wpdb->get_var(
        $wpdb->prepare("SELECT term_group FROM {$wpdb->terms} WHERE term_id = %d", $termId)
    );

    if ($currentGroup === $position
        && (string) $currentBd === (string) $position
        && (string) $currentDoc === (string) $position) {
        printf("%-16s %2d — уже так\n", $term->name, $position);
        continue;
    }

    printf("%-16s term_group %d → %d\n", $term->name, $currentGroup, $position);
    if ($apply) {
        // Это поле читает виджет витрины — оно и решает порядок.
        $wpdb->update($wpdb->terms, ["term_group" => $position], ["term_id" => $termId], ["%d"], ["%d"]);
        clean_term_cache($termId, "doc_category");
        // Обе меты — на будущее, если виджет переключат на сортировку по мете.
        update_term_meta($termId, "betterdocs_order", (string) $position);
        update_term_meta($termId, "doc_category_order", (string) $position);
        $changed++;
    }
}

if ($apply) {
    echo "\nЗаписано рубрик: {$changed}\n";
    if (function_exists("rocket_clean_domain")) {
        rocket_clean_domain();
        echo "Кэш WP Rocket очищен\n";
    }
} else {
    echo "\nПоказан предпросмотр. Запустите с --apply, чтобы записать.\n";
}
