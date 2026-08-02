import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { verifyPassword } from "@/lib/auth";
import { reclassifyForDeletion } from "@/lib/admin/tenant-cleanup";

// Массовое удаление "потерянных клиентов" (запрос пользователя 2026-08-02) —
// пустых Free-регистраций старше порога. Отдельный роут, а не цикл по
// существующему DELETE /api/admin/tenants/[id]: тот требует ввести название
// компании на каждого тенанта, что для пачки из полусотни мусорных записей
// физически неприменимо.
//
// Из-за этого здесь ЕДИНСТВЕННОЕ подтверждение — пароль администратора, и
// именно поэтому роут не доверяет присланному списку id: каждый тенант
// заново классифицируется по свежим данным (reclassifyForDeletion), и всё,
// что не `deletable` прямо сейчас, молча пропускается и возвращается в
// `skipped`. То есть даже присланный вручную id живого платящего тенанта
// удалить через этот роут невозможно — в отличие от DELETE-роута, который
// по замыслу умеет удалять кого угодно, но по одному и с полным
// подтверждением.
export async function POST(request: Request) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string") : [];
  const password = typeof body?.password === "string" ? body.password : "";

  if (ids.length === 0) {
    return NextResponse.json({ error: "Не выбрано ни одного владельца" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Введите пароль" }, { status: 400 });
  }
  if (!(await verifyPassword(password, admin.user.passwordHash))) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const { deletable, skipped } = await reclassifyForDeletion(ids);

  const deleted: string[] = [];
  const failed: { id: string; name: string }[] = [];

  // Последовательно, а не Promise.all: удаление тенанта каскадом задевает
  // почти все таблицы базы, и десяток таких транзакций разом на маленьком
  // проде (PG_TUNE_TOTAL_MB=512, см. docker-compose.prod.yml) — лишний риск
  // ради экономии секунд на операции, которая делается раз в месяц.
  for (const tenant of deletable) {
    try {
      // Тот же журнал, что и у одиночного удаления: CorrectionLog не
      // каскадируется на Tenant (нет FK, только entityId-строкой), поэтому
      // запись переживает сам тенант и остаётся единственным следом.
      await prisma.correctionLog.create({
        data: {
          entityType: "Tenant",
          entityId: tenant.id,
          correctedByUserId: admin.user.id,
          beforeJson: JSON.parse(
            JSON.stringify({ name: tenant.name, subscriptionStatus: tenant.subscriptionStatus })
          ),
          afterJson: { deleted: true },
          comment: "Массовое удаление неактивных пустых регистраций из админ-модуля",
        },
      });
      await prisma.tenant.delete({ where: { id: tenant.id } });
      // Загруженные файлы лежат на диске, каскад Prisma их не трогает —
      // см. тот же best-effort в DELETE /api/admin/tenants/[id].
      await rm(path.join(process.cwd(), "public", "uploads", tenant.id), { recursive: true, force: true }).catch(
        () => {}
      );
      deleted.push(tenant.id);
    } catch {
      // Один упавший тенант не должен ронять всю пачку — остальные
      // удаляются, а его имя возвращается админу списком.
      failed.push({ id: tenant.id, name: tenant.name });
    }
  }

  return NextResponse.json({ deleted, skipped, failed });
}
