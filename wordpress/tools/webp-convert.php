<?php
/**
 * Досконвертировать в WebP то, до чего не дотянулся пакет Imagify.
 *
 * Imagify упёрся в лимит на 420 файлах из 657, причём без пары остались самые
 * тяжёлые картинки главной. Квота тут не нужна: PHP на сервере собран с Imagick
 * и GD с поддержкой WebP, файлы лежат рядом — конвертируем на месте.
 *
 * Имя строго `<оригинал>.webp` — именно по такому WP Rocket находит пару и
 * подменяет картинку в копии кэша для браузеров с `Accept: image/webp`.
 *
 * Правило то же, что применили к результатам Imagify: копию оставляем ТОЛЬКО
 * если она заметно легче оригинала. На скриншотах приложения (резкий текст,
 * плоские заливки) WebP регулярно выходит тяжелее JPEG — такие копии не ускоряют,
 * а замедляют, потому что подмена идёт по факту наличия файла, без сравнения веса.
 */

$root = '/var/www/md33/data/www/rentos365.app/wp-content/uploads';
$quality = 82;          // как «агрессивный» уровень Imagify, визуально неотличимо
$minGain = 5;           // меньше 5% выгоды не стоит второго файла на диске

$dir = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
);

$todo = [];
foreach ($dir as $file) {
    if (!$file->isFile()) {
        continue;
    }
    $path = $file->getPathname();
    if (!preg_match('/\.(jpe?g)$/i', $path)) {
        continue;
    }
    if (strpos($path, '/backup/') !== false) {
        continue;   // резервные копии оригиналов Imagify — их никто не отдаёт
    }
    if (file_exists($path . '.webp')) {
        continue;
    }
    $todo[] = $path;
}

echo 'без пары: ' . count($todo) . " файлов\n\n";

$made = 0; $skipped = 0; $failed = 0;
$byteBefore = 0; $byteAfter = 0;

foreach ($todo as $path) {
    $target = $path . '.webp';

    try {
        $img = new Imagick($path);
        $img->setImageFormat('webp');
        $img->setImageCompressionQuality($quality);
        $img->stripImage();                       // метаданные в вебе не нужны
        $img->writeImage($target);
        $img->clear();
    } catch (Throwable $e) {
        $failed++;
        echo '  не смог: ' . basename($path) . ' — ' . $e->getMessage() . "\n";
        continue;
    }

    $so = filesize($path);
    $sw = filesize($target);

    // Выгода меньше порога — копию убираем, чтобы не подсунуть её вместо оригинала.
    if ($sw >= $so * (1 - $minGain / 100)) {
        unlink($target);
        $skipped++;
        continue;
    }

    $made++;
    $byteBefore += $so;
    $byteAfter += $sw;
}

printf("создано: %d\n", $made);
printf("отброшено (выгода меньше %d%%): %d\n", $minGain, $skipped);
printf("ошибок: %d\n", $failed);
printf("на созданных: %.1f МБ → %.1f МБ (экономия %.1f МБ, %d%%)\n",
    $byteBefore / 1048576,
    $byteAfter / 1048576,
    ($byteBefore - $byteAfter) / 1048576,
    $byteBefore ? round(($byteBefore - $byteAfter) * 100 / $byteBefore) : 0
);
