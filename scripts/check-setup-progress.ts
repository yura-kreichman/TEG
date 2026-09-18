// Разовая проверка «Первых шагов» (docs/spec/13-onboarding.md): прогресс
// настройки по всем тенантам базы из DATABASE_URL. Только чтение.
// Запуск: npx tsx scripts/check-setup-progress.ts
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { computeSetupProgress } from "@/lib/onboarding/setup-progress";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true }, orderBy: { createdAt: "asc" } });
  for (const t of tenants) {
    const p = await computeSetupProgress(t.id);
    const pending = p.steps.filter((s) => !s.done).map((s) => `${s.key}${s.hint ? `(${s.hint.key})` : ""}`);
    console.log(`${(t.slug ?? t.name).padEnd(34)} ${p.doneCount}/${p.total} ${p.complete ? "готово — карточки нет" : pending.join(", ")}`);
  }
}

main().finally(() => prisma.$disconnect());
