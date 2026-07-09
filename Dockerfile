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
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S rentos && adduser -S rentos -G rentos
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/icon-library ./icon-library
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/generated ./src/generated
RUN mkdir -p /app/public/uploads && chown -R rentos:rentos /app/public/uploads
USER rentos
EXPOSE 3000
CMD ["npm", "run", "start"]
