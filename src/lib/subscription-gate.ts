import { prisma } from "@/lib/prisma";
import { cached, invalidateCached, invalidateNamespace } from "@/lib/short-cache";

// Состояние подписки владельца для гейта «только чтение» в src/proxy.ts.
//
// Гейт срабатывает на КАЖДОМ мутирующем запросе владельца, и до аудита
// производительности 2026-08-13 стоил двух запросов к базе: сначала User
// (роль и тенант), потом Tenant (статус подписки). То есть каждое сохранение
// формы, каждый тап оператора… — плюс два SELECT'а до того, как роут вообще
// начал работать. Это заметная часть тех 306 тыс. обращений к Tenant и
// 86 тыс. к User, что видно в pg_stat_user_tables на проде.
//
// Кэшируется СОСТОЯНИЕ ПОДПИСКИ, а не право доступа. Разница принципиальна:
// сам вход и права по-прежнему проверяются свежим чтением в
// requireOwner/requireSuperAdmin (там же отзыв сессий), а здесь — только
// биллинговый статус, который меняется вебхуком FluentCart, действием
// Super Admin или ночным планировщиком. Все три пути сбрасывают кэш явно,
// поэтому задержки применения нет; TTL — страховка.
//
// Худший случай при промахе сброса: владелец с только что истёкшей подпиской
// до 30 секунд может сохранить ещё одну форму. Обратный случай (оплатил, но
// ещё заблокирован) закрыт тем же сбросом на вебхуке оплаты.
const NS = "subscription-gate";

export interface GateState {
  role: string;
  tenantId: string | null;
  subscriptionStatus: string | null;
}

export async function getSubscriptionGateState(userId: string): Promise<GateState | null> {
  return cached(NS, userId, async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, tenantId: true },
    });
    if (!user) return null;
    if (user.role !== "owner" || !user.tenantId) {
      return { role: user.role, tenantId: user.tenantId, subscriptionStatus: null };
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { subscriptionStatus: true },
    });
    return { role: user.role, tenantId: user.tenantId, subscriptionStatus: tenant?.subscriptionStatus ?? null };
  });
}

/** Сбрасывает состояние одного пользователя (смена роли, привязка тенанта). */
export function invalidateSubscriptionGateForUser(userId: string): void {
  invalidateCached(NS, userId);
}

/**
 * Сбрасывает гейт целиком. Ключ здесь — userId, а статус меняется у ТЕНАНТА,
 * и владельцев у тенанта может быть несколько (tenantId не @unique в схеме) —
 * искать их всех ради точечного сброса означало бы ровно тот запрос к базе,
 * которого мы избегаем. Пространство имён размером с число активных
 * владельцев, очистить его целиком дешевле и надёжнее.
 */
export function invalidateSubscriptionGate(): void {
  invalidateNamespace(NS);
}
