#!/usr/bin/env bash
# Запускается на VPS в /srv/rentos после `git push production main`
# (см. deploy/post-receive и docs/spec для контекста). Пересобирает образ,
# прогоняет миграции и перезапускает контейнер без простоя базы.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Нет .env в $(pwd) — скопируйте .env.production.example в .env и заполните секреты перед первым деплоем." >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d app
docker image prune -f
