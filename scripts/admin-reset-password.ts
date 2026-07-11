import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Перечитывает ADMIN_PASSWORD из .env и обновляет хэш у существующего Super
// Admin'а (docs/spec/06-super-admin.md, п.2, "на случай, если пароль забыт").
// Логин не трогает — используй admin:seed, если нужно сменить и логин тоже.
async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error("ADMIN_PASSWORD обязателен в .env");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const existing = await prisma.user.findFirst({ where: { role: "super_admin" } });
  if (!existing) {
    console.error("Super Admin не найден — сначала запусти admin:seed");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
  console.log(`Пароль обновлён для Super Admin (логин: ${existing.login ?? "не задан"})`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
