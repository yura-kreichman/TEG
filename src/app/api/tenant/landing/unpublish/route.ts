import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

// Снятие с публикации → публичный роут отдаёт 404 (докс, "Жизненный цикл").
// publishedAt НЕ обнуляется — просто дата первой публикации, не признак
// текущего статуса (тот — status).
export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const landing = await prisma.landing.findUnique({ where: { tenantId: owner.tenantId } });
  if (!landing) {
    return NextResponse.json({ error: "Лендинг не найден" }, { status: 404 });
  }

  await prisma.landing.update({ where: { id: landing.id }, data: { status: "draft" } });
  await revalidateLandingForTenant(owner.tenantId);
  revalidatePath("/sitemap.xml");
  return NextResponse.json({ ok: true });
}
