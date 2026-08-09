#!/bin/bash
# Удалить WebP-копии, которые вышли НЕ легче оригинала.
#
# WP Rocket подменяет картинку на .webp по факту наличия файла и веса не
# сравнивает. Значит такая копия не ускоряет, а замедляет: на скриншотах
# приложения (резкий текст, плоские заливки) WebP прибавил в сумме 426 КБ.
# Оригиналы не трогаем, удаляем только производные.
#
# Имена переменных — только латиницей: bash на этом сервере кириллицу в именах
# не принимает и молча ломает арифметику (наступил на это здесь же).
set -u
cd /var/www/md33/data/www/rentos365.app/wp-content/uploads || exit 1

LIST=/tmp/webp-worse-than-original.txt
: > "$LIST"

removed=0
bytes=0

for f in $(find . -name '*.webp'); do
    o="${f%.webp}"
    [ -f "$o" ] || continue
    sw=$(stat -c%s "$f")
    so=$(stat -c%s "$o")
    if [ "$sw" -ge "$so" ]; then
        printf '%s\toriginal=%s\twebp=%s\n' "$f" "$so" "$sw" >> "$LIST"
        rm -f "$f"
        removed=$((removed + 1))
        bytes=$((bytes + sw))
    fi
done

echo "удалено файлов: $removed ($((bytes / 1024)) КБ)"
echo "список: $LIST ($(wc -l < "$LIST") строк)"

left=0
for f in $(find . -name '*.webp'); do
    o="${f%.webp}"
    [ -f "$o" ] || continue
    if [ "$(stat -c%s "$f")" -ge "$(stat -c%s "$o")" ]; then
        left=$((left + 1))
    fi
done
echo "осталось webp не легче оригинала: $left"
echo "всего webp теперь: $(find . -name '*.webp' | wc -l)"
