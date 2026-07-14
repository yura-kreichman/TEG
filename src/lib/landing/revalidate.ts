import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

/**
 * Ревалидация SSG-страницы лендинга (docs/spec/08-landing.md, "Жизненный
 * цикл": "изменения данных системы отражаются на опубликованном лендинге
 * автоматически"). Вызывается из мутаций тарифов/зон/активов/точек/
 * наполнения/контактов — полный список см. в комментарии Шага 3 в
 * docs/spec/08-landing.md. Best-effort: если у тенанта ещё нет slug
 * (не должно случаться после бэкфилла) или самой Landing-записи, просто
 * ничего не делает — страница ещё недостижима публично в любом случае.
 */
export async function revalidateLandingForTenant(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant?.slug) return;
  revalidatePath(`/s/${tenant.slug}`);
}
