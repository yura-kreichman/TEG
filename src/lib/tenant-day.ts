import { prisma } from "@/lib/prisma";

/**
 * Пояс тенанта и граница его дня — одним запросом, одним местом.
 *
 * До этого в каждом дневном роуте была скопирована одна и та же пара строк
 * (findUnique({ select: { timezone: true } }) и `?? "UTC"`) — восемнадцать
 * копий. Пока к дню относился только пояс, это было терпимо; когда добавилась
 * граница (решение пользователя 2026-08-06 — кабинет считает бизнес-день, а не
 * календарный), восемнадцать одинаковых правок в разных файлах — это
 * восемнадцать шансов забыть одну. Дальше всё, что относится к "дню тенанта",
 * добавляется здесь.
 *
 * boundary никогда не null: у тенанта поле обязательное, "00:00" — только
 * защита от отсутствующего тенанта (не должно случаться, но роуты не падают).
 */
export async function getTenantDayContext(tenantId: string): Promise<{ timezone: string; boundary: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  return {
    timezone: tenant?.timezone ?? "UTC",
    boundary: tenant?.businessDayBoundary ?? "00:00",
  };
}
