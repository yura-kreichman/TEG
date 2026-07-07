This is a Next.js + TypeScript SaaS starter, with PostgreSQL (via Docker) and Prisma, and a minimal login/password + PIN authentication scaffold.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- PostgreSQL 16 running in Docker (`docker-compose.yml`)
- Prisma ORM (`prisma/schema.prisma`, client generated to `src/generated/prisma`)
- Cookie-based session auth with password (bcrypt) and optional PIN login (`src/lib/auth.ts`, `src/app/api/auth/*`)

## Getting Started

1. Copy `.env.example` to `.env` if you don't already have one, and set `AUTH_SECRET` to a random value (`.env` already has one generated for local dev).
2. Start the database:

```bash
docker compose up -d
```

3. Apply migrations (only needed after schema changes):

```bash
npx prisma migrate dev
```

4. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
