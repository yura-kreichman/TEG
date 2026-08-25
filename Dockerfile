# Продовый образ RentOS. Не оптимизируем под `output: "standalone"` — Prisma
# CLI (миграции) и генератор клиента должны остаться доступны в рантайм-образе,
# а весь проект достаточно небольшой, чтобы не усложнять сборку ради размера.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
# Идентификатор сборки (запрос владельца 2026-08-13) — хеш коммита,
# подставляет deploy/deploy.sh. Next дописывает его к адресам статики и
# кладёт в data-dpl-id на <html>; клиент сравнивает его с ответом
# /api/version и перезагружается, когда версия сменилась.
ARG NEXT_DEPLOYMENT_ID=""
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# Публичная история изменений собирается здесь, а не на хосте: node есть только
# в этом слое. Дамп коммитов кладёт в контекст deploy/deploy.sh — в образе .git
# нет вовсе (changelog/README.md).
RUN node scripts/build-changelog.mjs
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
# То же значение и в рантайме: сервер обязан отдавать /api/version ровно ту
# версию, с которой собрана статика, иначе клиент уйдёт в вечную перезагрузку.
ARG NEXT_DEPLOYMENT_ID=""
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
RUN addgroup -S rentos && adduser -S rentos -G rentos
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/generated ./src/generated
# pdfkit не умеет грузить шрифты из webpack-бандла — читает TTF с диска по
# рантайм-пути process.cwd()/src/lib/instructions/fonts (см. pdf.ts), поэтому
# эту папку нужно скопировать явно, в отличие от остального src/, который
# рантайму не нужен (уже скомпилирован в .next).
COPY --from=build /app/src/lib/instructions/fonts ./src/lib/instructions/fonts
RUN mkdir -p /app/public/uploads && chown -R rentos:rentos /app/public/uploads
USER rentos
EXPOSE 3000
CMD ["npm", "run", "start"]
