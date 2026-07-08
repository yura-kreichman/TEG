# RideTrack

Мультитенантный SaaS для учёта проката детских аттракционов (электромобили, батуты, VR и т.д.) — модуль «Счётчики» (сдача итогов, показания, тарифы) и «Деньги» (единый денежный журнал), с отдельными кабинетом владельца и PWA оператора.

Спецификация и дизайн-система — в [docs/spec/](docs/spec/) и [docs/design/](docs/design/); начните с [docs/spec/00-architecture.md](docs/spec/00-architecture.md) и [CLAUDE.md](CLAUDE.md).

## Стек

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- PostgreSQL 16 в Docker (`docker-compose.yml`) + Prisma 7 (`@prisma/adapter-pg` driver adapter обязателен, генератор клиента — `prisma-client`)
- Свой код авторизации (владелец — email/пароль/PIN, оператор — PIN на устройстве точки), без сторонних auth-библиотек

## Запуск

1. Скопируйте `.env.example` в `.env` и задайте `AUTH_SECRET` случайным значением.
2. Поднимите базу:

```bash
docker compose up -d
```

3. Примените миграции:

```bash
npx prisma migrate dev
```

4. Запустите dev-сервер:

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Деплой

Планируется физический/выделенный хостинг, не Vercel — избегайте Vercel-специфичных возможностей.
