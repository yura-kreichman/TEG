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

# Версия сборки — короткий хеш задеплоенного коммита (запрос владельца
# 2026-08-13). Уезжает в образ аргументом сборки: Next помечает им статику,
# /api/version отдаёт его клиенту, и открытые сутками планшеты
# перезагружаются сами, как только деплой доехал. Берём из голого
# репозитория, а не из рабочего дерева: .git сюда не копируется.
export NEXT_DEPLOYMENT_ID="$(git --git-dir=/srv/git/rentos.git rev-parse --short HEAD 2>/dev/null || date +%s)"
echo "Версия сборки: $NEXT_DEPLOYMENT_ID"

docker compose -f docker-compose.prod.yml build app db
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d app
docker image prune -f
