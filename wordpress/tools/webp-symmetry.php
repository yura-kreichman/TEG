<?php
/**
 * Выровнять WebP по парам «русский снимок → английский».
 *
 * Подмена картинки на .webp и подмена русского снимка на английский — две разные
 * подмены одного и того же адреса, и они мешают друг другу, если у одной стороны
 * пары .webp есть, а у другой нет: WP Rocket переписывает русский адрес в .webp,
 * а в словаре такой ключ отсутствует — и на английской странице остаётся русский
 * снимок. Ровно так и случилось: у части английских файлов .webp был удалён,
 * потому что вышел тяжелее оригинала.
 *
 * Правило: либо .webp есть у обоих, либо ни у кого. Одинокую копию удаляем, а не
 * досоздаём — её отсутствие с другой стороны не случайность, а результат проверки
 * «webp не легче оригинала». Терять при этом нечего: пара из обычных .jpg в
 * словаре есть и работает.
 */
global $wpdb;

$langs = ['en_us', 'it_it', 'ro_ro'];
$home = untrailingslashit((string) get_option('home'));

$toPath = function ($url) use ($home) {
    return ABSPATH . ltrim(str_replace($home, '', $url), '/');
};

$asymmetric = [];

foreach ($langs as $suffix) {
    $table = $wpdb->prefix . 'trp_dictionary_ru_ru_' . $suffix;
    $rows = $wpdb->get_results(
        "SELECT original, translated FROM $table
         WHERE original LIKE '%wp-content/uploads%' AND translated <> ''
           AND original NOT LIKE '%.webp'"
    );

    foreach ($rows as $row) {
        $ru = $toPath($row->original) . '.webp';
        $en = $toPath($row->translated) . '.webp';
        $hasRu = file_exists($ru);
        $hasEn = file_exists($en);
        if ($hasRu === $hasEn) {
            continue;
        }
        // Ключ по пути, чтобы один и тот же файл не удалять трижды (три языка).
        $asymmetric[$hasRu ? $ru : $en] = true;
    }
}

echo 'несимметричных пар (файлов к удалению): ' . count($asymmetric) . "\n\n";

$removed = 0; $bytes = 0;
foreach (array_keys($asymmetric) as $path) {
    if (!file_exists($path)) {
        continue;
    }
    $bytes += filesize($path);
    unlink($path);
    $removed++;
    echo '  убран ' . basename($path) . "\n";
}

printf("\nудалено: %d файлов (%.0f КБ)\n", $removed, $bytes / 1024);

// Контроль: не осталось ли записей в словаре, указывающих на исчезнувший файл.
$broken = 0;
foreach ($langs as $suffix) {
    $table = $wpdb->prefix . 'trp_dictionary_ru_ru_' . $suffix;
    $rows = $wpdb->get_results(
        "SELECT id, original, translated FROM $table
         WHERE original LIKE '%.webp' AND translated <> ''"
    );
    foreach ($rows as $row) {
        if (file_exists($toPath($row->original)) && file_exists($toPath($row->translated))) {
            continue;
        }
        $wpdb->delete($table, ['id' => $row->id]);
        $broken++;
    }
}
echo "удалено записей словаря, указывавших в пустоту: $broken\n";

// И проверка симметрии заново.
$left = 0;
foreach ($langs as $suffix) {
    $table = $wpdb->prefix . 'trp_dictionary_ru_ru_' . $suffix;
    $rows = $wpdb->get_results(
        "SELECT original, translated FROM $table
         WHERE original LIKE '%wp-content/uploads%' AND translated <> '' AND original NOT LIKE '%.webp'"
    );
    foreach ($rows as $row) {
        if (file_exists($toPath($row->original) . '.webp') !== file_exists($toPath($row->translated) . '.webp')) {
            $left++;
        }
    }
}
echo "осталось несимметричных: $left\n";
