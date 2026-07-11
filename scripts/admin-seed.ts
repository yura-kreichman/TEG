import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Создаёт/чинит аккаунт Super Admin из ADMIN_LOGIN/ADMIN_PASSWORD в .env
// (docs/spec/06-super-admin.md, п.2). Идемпотентен: если Super Admin уже
// существует (по role, не по login — на момент первого запуска после
// добавления поля login у существующего аккаунта его ещё нет), просто
// обновляет его login+пароль, а не плодит второй аккаунт.
async function main() {
  const login = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;
  if (!login || !password) {
    console.error("ADMIN_LOGIN и ADMIN_PASSWORD обязательны в .env");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({ where: { role: "super_admin" } });

  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { login, passwordHash } });
    console.log(`Обновлён существующий Super Admin (id=${existing.id}) — логин: ${login}`);
  } else {
    const created = await prisma.user.create({
      data: {
        // email NOT NULL на всю таблицу (используется Owner'ом) — Super Admin
        // им не пользуется для входа, плейсхолдер только чтобы удовлетворить
        // колонку и не столкнуться с чужим реальным email по уникальности.
        email: `${login}@admin.internal`,
        login,
        passwordHash,
        role: "super_admin",
      },
    });
    console.log(`Создан Super Admin (id=${created.id}) — логин: ${login}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
