import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getOperatorSessionId, getActivatedPoint } from "@/lib/operator-auth";
import { isCurrencyCode, type CurrencyCode } from "@/lib/currency";

// Резолв валюты тенанта текущей сессии — та же цепочка Owner → Operator →
// активированное устройство точки, что у resolveLocale() (src/lib/i18n.ts),
// но без pre-auth-ветки: экраны входа/регистрации денег не показывают,
// резолвить там нечего. Отдельный файл (не lib/currency.ts) — в lib/currency.ts
// нет server-only импортов специально, его подключает клиентский <Money>.
export async function resolveTenantCurrency(): Promise<CurrencyCode | null> {
  const userId = await getSessionUserId();
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, tenant: { select: { currency: true } } },
    });
    if (user?.role === "owner" && user.tenant?.currency && isCurrencyCode(user.tenant.currency)) {
      return user.tenant.currency;
    }
  }

  const operatorId = await getOperatorSessionId();
  if (operatorId) {
    const operator = await prisma.operator.findUnique({
      where: { id: operatorId },
      select: { tenant: { select: { currency: true } } },
    });
    if (operator?.tenant?.currency && isCurrencyCode(operator.tenant.currency)) {
      return operator.tenant.currency;
    }
  }

  const point = await getActivatedPoint();
  if (point) {
    const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId }, select: { currency: true } });
    if (tenant?.currency && isCurrencyCode(tenant.currency)) return tenant.currency;
  }

  return null;
}
