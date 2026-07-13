#!/usr/bin/env bash
# Разовый скрипт: переносит БД с продакшна (my.rentos365.app) в локальный Docker.
# Запусти из Git Bash: bash scripts/sync-prod-db-to-local.sh
# ПОЛНОСТЬЮ ЗАМЕНЯЕТ локальную БД teg_saas данными с прода.
set -e
export MSYS_NO_PATHCONV=1

echo "1/4 Снимаю дамп на проде..."
ssh root@194.156.65.114 "docker exec myrentos365app-db-1 pg_dump -U teg -d teg_saas -Fc -f /tmp/teg_saas_prod.dump && docker cp myrentos365app-db-1:/tmp/teg_saas_prod.dump /tmp/teg_saas_prod.dump"

echo "2/4 Скачиваю дамп..."
scp root@194.156.65.114:/tmp/teg_saas_prod.dump ./teg_saas_prod.dump

echo "3/4 Заливаю в локальный контейнер teg-db-1 (текущие локальные данные будут заменены)..."
docker cp ./teg_saas_prod.dump teg-db-1:/tmp/teg_saas_prod.dump
docker exec teg-db-1 pg_restore -U teg -d teg_saas --clean --if-exists -1 /tmp/teg_saas_prod.dump

echo "4/5 Убираю дамп за собой..."
ssh root@194.156.65.114 "docker exec myrentos365app-db-1 rm -f /tmp/teg_saas_prod.dump; rm -f /tmp/teg_saas_prod.dump"
rm ./teg_saas_prod.dump

echo "5/5 Переношу файлы (public/uploads: фото активов, аватары) — заменяю локальную папку целиком..."
rm -rf ./public/uploads
mkdir -p ./public/uploads
scp -r root@194.156.65.114:/var/www/md33/data/www/my.rentos365.app/public/uploads/. ./public/uploads/

echo "Готово. Перезапусти npm run dev, если он уже был запущен."
