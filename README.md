# RentOS

Мультитенантный SaaS для учёта детского проката (электромобили, батуты, квадроциклы, игровые комнаты, VR и т.д.) — модуль «Счётчики» (сдача итогов, показания, тарифы) и «Деньги» (единый денежный журнал), с отдельными кабинетом владельца и PWA оператора.

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

Физический/выделенный хостинг (VPS), не Vercel — избегайте Vercel-специфичных возможностей.
Приложение — один долгоживущий Node-процесс (в `src/instrumentation.ts` запускается
фоновый планировщик сводок), поэтому serverless/edge-хостинги не подходят.

Схема: Docker Compose (`docker-compose.prod.yml`) поднимает контейнеры `app` и
`db` на VPS, Nginx на хосте проксирует `rentos365.app` на `127.0.0.1:3000` и
терминирует TLS (Let's Encrypt/certbot). Обновление кода — через голый git-репозиторий
на самом VPS: `git push production main` триггерит хук, который пересобирает
образ, прогоняет миграции Prisma и перезапускает `app` без даунтайма базы.

### Разовая настройка VPS

1. Установите Docker, Docker Compose plugin, Nginx, certbot.
2. Создайте голый репозиторий и рабочую директорию:
   ```bash
   mkdir -p /srv/git/rentos.git /srv/rentos
   git init --bare /srv/git/rentos.git
   ```
3. Локально добавьте remote и запушьте:
   ```bash
   git remote add production ssh://user@your-vps/srv/git/rentos.git
   git push production main
   ```
4. На сервере разверните рабочую копию и хук:
   ```bash
   git --work-tree=/srv/rentos --git-dir=/srv/git/rentos.git checkout -f main
   cp /srv/rentos/deploy/post-receive /srv/git/rentos.git/hooks/post-receive
   chmod +x /srv/git/rentos.git/hooks/post-receive
   ```
5. Скопируйте `.env.production.example` в `/srv/rentos/.env` и заполните `POSTGRES_PASSWORD`, `AUTH_SECRET` (`openssl rand -base64 32`) и остальные секреты.
6. Скопируйте `deploy/nginx/rentos365.app.conf` в `/etc/nginx/sites-available/`, включите (`sites-enabled`), `nginx -t && systemctl reload nginx`, затем `certbot --nginx -d rentos365.app -d www.rentos365.app`.
7. Первый деплой: `bash /srv/rentos/deploy/deploy.sh`.

### Дальнейшие деплои

```bash
git push production main
```

Хук `post-receive` сам вызывает `deploy/deploy.sh` (сборка образа → миграции → перезапуск `app`).

Health-check контейнера и Nginx — `GET /api/health` (проверяет и сам процесс, и доступность БД).

Загруженные файлы (`/uploads/<tenantId>/...`) живут в именованном Docker-томе `uploads_data`, переживают пересборку образа.
