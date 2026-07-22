#!/usr/bin/env bash
# Восстановление дампа Postgres из db-backups/rentos-YYYY-MM-DD.sql.gz.
#
# ISPmanager умеет вернуть сам ФАЙЛ дампа через свой интерфейс "Резервные
# копии" (файловый бэкап сайта включает db-backups/ автоматически — см.
# backup-db.sh) — но накатить его обратно в Postgres он не может, панель
# ничего не знает про Docker/Postgres. Этот шаг — отдельный, вручную:
#
#   1. В интерфейсе ISPmanager: Резервные копии → восстановить нужную дату
#      для сайта my.rentos365.app (это вернёт файлы, включая db-backups/).
#   2. На сервере: ./deploy/restore-db.sh db-backups/rentos-2026-07-22.sql.gz
#
# ВНИМАНИЕ: дамп сделан с --clean --if-exists — восстановление ПОЛНОСТЬЮ
# заменяет текущее содержимое базы содержимым дампа (все данные, записанные
# после даты дампа, будут потеряны). Действие необратимо без ещё одного
# бэкапа "до".
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?Укажите путь к файлу дампа, например: deploy/restore-db.sh db-backups/rentos-2026-07-22.sql.gz}"

if [ ! -f "$FILE" ]; then
  echo "Файл не найден: $FILE" >&2
  exit 1
fi

gunzip -c "$FILE" | docker compose -f docker-compose.prod.yml exec -T db psql -U teg teg_saas
