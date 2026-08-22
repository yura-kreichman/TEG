#!/bin/sh
# Замер доступности RentOS: раз в 5 минут из crontab пользователя md33.
#
#   */5 * * * * /bin/sh /var/www/md33/data/rentos-uptime/check.sh >/dev/null 2>&1
#
# Шаг обязан совпадать с RENTOS_UPTIME_STEP в mu-плагине.
# Пишем в CSV одну строку на замер: unix-время и код ответа. Файл лежит ВНЕ
# корня сайта (/var/www/md33/data/, а не .../data/www/), наружу не отдаётся.
# Прореживает файл агрегатор в mu-плагине rentos-uptime.php.
#
# Проверяем публичный адрес, а не localhost: так в замер попадает вся цепочка
# nginx → контейнер → Postgres, то есть ровно то, что видит клиент.
# /api/health не просто отвечает 200, а дёргает базу (SELECT 1).

DIR=/var/www/md33/data/rentos-uptime
URL=https://my.rentos365.app/api/health

mkdir -p "$DIR"

# Третьим полем пишем время ответа в секундах — из него считается медиана
# отклика в подвале. Строки из двух полей (замеры до 2026-08-22) читаются
# по-прежнему, время у них просто отсутствует.
out=$(curl -s -o /dev/null -m 8 -w '%{http_code} %{time_total}' "$URL" 2>/dev/null)

code=$(echo "$out" | cut -d' ' -f1)
secs=$(echo "$out" | cut -d' ' -f2)

# curl не дозвонился — вывод пустой; пишем 0, чтобы замер считался неудачным.
[ -z "$code" ] && code=0
[ -z "$secs" ] && secs=0

printf '%s,%s,%s\n' "$(date +%s)" "$code" "$secs" >> "$DIR/samples.csv"
