import { requireOwner } from "@/lib/require-owner";
import { requireOperator } from "@/lib/require-operator";

// Подписка на push может прийти и от Владельца, и от Оператора (добавлено
// 2026-07-14 для уведомлений о новых Задачах) — единая точка определения,
// от чьего имени сохранять/удалять PushSubscription, чтобы клиентский код
// (install-app-banner.tsx, работает в обоих кабинетах) не должен был сам
// знать, кто сейчас залогинен, и роуты /api/push/* оставались одни на оба
// случая. requireOwner() проверяется первым — Owner-сессия (email/пароль/PIN)
// и Operator-сессия (активированное устройство точки) технически могут
// пересекаться на одном браузере (см. реальный прод-баг 2026-07-14 в
// manifest.ts), но каждый запрос относится к одной ролевой подписке.
export type PushIdentity = { tenantId: string; userId: string } | { tenantId: string; operatorId: string };

export async function resolvePushIdentity(): Promise<PushIdentity | null> {
  const owner = await requireOwner();
  if (owner) return { tenantId: owner.tenantId, userId: owner.user.id };

  const ctx = await requireOperator();
  if (ctx) return { tenantId: ctx.operator.tenantId, operatorId: ctx.operator.id };

  return null;
}
