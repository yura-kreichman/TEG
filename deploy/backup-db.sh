#!/usr/bin/env bash
# Ежедневный дамп Postgres — запускается cron'ом на сервере ДО ночного
# бэкапа ISPmanager (см. docs в этом же файле у restore-db.sh). Кладёт
# сжатый дамп в db-backups/ ВНУТРИ чекаута сайта — не отдельное хранилище:
# обычный файловый бэкап ISPmanager архивирует весь /var/www/md33 целиком,
# значит дамп автоматически попадает в стандартную резервную копию хостинга
# без какой-либо отдельной настройки в самом ISPmanager (запрос пользователя
# 2026-07-22: "чтобы было удобно из одного интерфейса восстанавливать").
# db-backups/ — не в git (.gitignore), переживает деплой: post-receive делает
# `git checkout -f`, не `git clean`, untracked-файлы не трогает.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="db-backups"
mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d)
FILE="$BACKUP_DIR/rentos-$STAMP.sql.gz"

# --clean --if-exists — дамп содержит DROP перед CREATE, чтобы restore-db.sh
# можно было безопасно повторно накатить поверх уже существующей базы, не
# только на пустую.
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U teg --clean --if-exists teg_saas | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

# Храним последние 7 дампов — старше 7 дней удаляются, чтобы папка не росла
# бесконечно и не раздувала файловый бэкап ISPmanager с каждым днём.
find "$BACKUP_DIR" -name 'rentos-*.sql.gz' -mtime +7 -delete
