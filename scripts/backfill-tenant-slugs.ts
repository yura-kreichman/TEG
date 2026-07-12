import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { generateUniqueSlug } from "../src/lib/instructions/slug";

// Одноразовый бэкфилл Tenant.slug для тенантов, созданных до модуля
// Инструктажи (docs/spec/07-instructions.md, Шаг 2) — новые тенанты
// получают slug прямо при регистрации (см. src/app/api/auth/register/route.ts).
// Идемпотентен: пропускает тенантов, у которых slug уже есть.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenants = await prisma.tenant.findMany({ where: { slug: null }, select: { id: true, name: true } });
  console.log(`${tenants.length} тенант(ов) без slug`);

  for (const tenant of tenants) {
    const slug = await generateUniqueSlug(tenant.name, async (candidate) => {
      const conflict = await prisma.tenant.findUnique({ where: { slug: candidate } });
      return !!conflict;
    });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { slug } });
    console.log(`  ${tenant.name} -> ${slug}`);
  }
}

main().finally(() => prisma.$disconnect());
