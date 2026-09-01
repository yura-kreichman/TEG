<?php
/**
 * Применение переводов сегментов документации в словарь TranslatePress.
 *
 * Данные — docs-translations.json рядом с этим файлом: ключ это ТОЧНЫЙ русский
 * оригинал, значение — карта языков. Переводы написаны вручную: машинный
 * перевод на этом сайте отключён сознательно (DeepL ломает продуктовые
 * термины — «Пуски» становились Single-use и сталкивались с «Билетами»).
 *
 * Запуск на сервере (wp-cli тут НЕТ):
 *   php /tmp/docs-translations.php          — показать, что изменится
 *   php /tmp/docs-translations.php --apply  — записать
 *
 * Ищет строку по `original`, а НЕ по id: id в языковых таблицах разные.
 * Пишет status=2 («проверенный»), как требует правило сайта.
 * Идемпотентный: строку с уже совпадающим переводом пропускает.
 */

require_once "/var/www/md33/data/www/rentos365.app/wp-load.php";

global $wpdb;

$apply = in_array("--apply", $argv, true);
$jsonPath = __DIR__ . "/docs-translations.json";

if (!file_exists($jsonPath)) {
    fwrite(STDERR, "Не найден {$jsonPath}\n");
    exit(1);
}

$data = json_decode(file_get_contents($jsonPath), true);
if (!is_array($data)) {
    fwrite(STDERR, "docs-translations.json не разбирается как JSON: " . json_last_error_msg() . "\n");
    exit(1);
}
unset($data["_note"]);

// Таблицы словаря: код языка → суффикс таблицы.
$tables = [
    "en" => $wpdb->prefix . "trp_dictionary_ru_ru_en_us",
    "uk" => $wpdb->prefix . "trp_dictionary_ru_ru_uk",
    "it" => $wpdb->prefix . "trp_dictionary_ru_ru_it_it",
    "ro" => $wpdb->prefix . "trp_dictionary_ru_ru_ro_ro",
];

foreach ($tables as $lang => $table) {
    $exists = $wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $table));
    if (!$exists) {
        fwrite(STDERR, "Нет таблицы {$table} — прерываю, ничего не записано\n");
        exit(1);
    }
}

$stat = [];
$missing = [];

foreach ($tables as $lang => $table) {
    $stat[$lang] = ["written" => 0, "same" => 0, "absent" => 0];

    foreach ($data as $original => $langs) {
        if (!isset($langs[$lang]) || $langs[$lang] === "") {
            continue;
        }
        $translation = $langs[$lang];

        // Строка регистрируется TranslatePress при первом показе страницы.
        // Если её нет — страница на этом языке ещё не отрисована; дописывать
        // строку руками нельзя, у неё есть связь с trp_original_strings.
        $rows = $wpdb->get_results(
            $wpdb->prepare("SELECT id, translated FROM {$table} WHERE original = %s", $original)
        );

        if (!$rows) {
            $stat[$lang]["absent"]++;
            $missing[$lang][] = mb_substr($original, 0, 60);
            continue;
        }

        foreach ($rows as $row) {
            if ($row->translated === $translation) {
                $stat[$lang]["same"]++;
                continue;
            }
            if ($apply) {
                $wpdb->update(
                    $table,
                    ["translated" => $translation, "status" => 2],
                    ["id" => $row->id],
                    ["%s", "%d"],
                    ["%d"]
                );
            }
            $stat[$lang]["written"]++;
        }
    }
}

echo $apply ? "ЗАПИСЬ\n\n" : "ПРЕДПРОСМОТР (ничего не записано)\n\n";
foreach ($stat as $lang => $s) {
    printf(
        "%-3s записать: %-4d уже так: %-4d нет в словаре: %d\n",
        $lang, $s["written"], $s["same"], $s["absent"]
    );
}

if ($missing) {
    echo "\nСтроки, которых нет в словаре (страница на этом языке ещё не отрисована —\n";
    echo "откройте её один раз и запустите скрипт снова):\n";
    foreach ($missing as $lang => $list) {
        echo "  [{$lang}] " . count($list) . " шт., например: " . implode(" | ", array_slice($list, 0, 3)) . "\n";
    }
}

if ($apply) {
    // Страницы статей лежат в кэше WP Rocket, копии раздельные по языкам.
    if (function_exists("rocket_clean_domain")) {
        rocket_clean_domain();
        echo "\nКэш WP Rocket очищен\n";
    }
} else {
    echo "\nЗапустите с --apply, чтобы записать.\n";
}
