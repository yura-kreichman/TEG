import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { normalizeBgEffect } from "@/components/bg-effects/shared";

// Доступна ли Сотруднику печать на ЭТОМ устройстве прямо сейчас (запрос
// пользователя 2026-07-20) — оба условия разом: тенант включил печать
// глобально (Настройки → Система) И на этом конкретном устройстве стоит
// ручной тумблер "есть принтер" (Точки → Устройства). Кнопки печати
// (Товары/Прибывания/Пуски/Z-отчёт) опрашивают этот роут один раз при
// монтировании экрана, не при каждом клике.
export async function GET() {
  const ctx = await requireOperator();
  if (!ctx) {
    // "оператора", не "сотрудника" (аудит 2026-07-26) — единственный выброс
    // формулировки среди ~90 роутов с requireOperator(), все остальные
    // единообразно пишут "Требуется вход оператора".
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.point.tenantId },
    select: {
      name: true,
      logoUrl: true,
      printingEnabled: true,
      receiptShowLogo: true,
      receiptShowTenantName: true,
      receiptCompactHeader: true,
      receiptFooterContent: true,
      bgEffect: true,
      accentScheme: true,
    },
  });

  return NextResponse.json({
    available: Boolean(tenant?.printingEnabled) && ctx.device.hasPrinter,
    tenantName: tenant?.name ?? "",
    logoUrl: tenant?.logoUrl ?? null,
    receiptShowLogo: tenant?.receiptShowLogo ?? true,
    receiptShowTenantName: tenant?.receiptShowTenantName ?? true,
    receiptCompactHeader: tenant?.receiptCompactHeader ?? false,
    receiptFooterContent: tenant?.receiptFooterContent ?? null,
    // Не про печать — переиспользует этот же роут ради tenantId-запроса,
    // который PWA Сотрудника и так уже делает при монтировании (запрос
    // пользователя 2026-07-27, тот же приём, что logoUrl выше).
    // normalizeBgEffect — старое сохранённое "sparkles" (удалённый эффект
    // "Искры", заменён "Гиперпространством" 2026-07-28) трактуется как
    // "hyperspace" при чтении, тот же приём, что и api/tenant/
    // system-settings/route.ts.
    bgEffect: normalizeBgEffect(tenant?.bgEffect),
    // Акцентная схема (реальный баг, найден пользователем 2026-07-28:
    // "акцентная схема владельца не влияет на цвета у сотрудника") —
    // раньше PWA Сотрудника получал её ТОЛЬКО в момент логина (cookie
    // ставится в api/auth/operator/login/route.ts), а сессия оператора
    // может держаться открытой на терминале часами (устройство-точка) — при
    // смене схемы владельцем УЖЕ залогиненный оператор не видел изменение
    // без повторного входа. Теперь опрашивается тем же useLiveRefetch, что
    // и остальная "живая" информация PWA Сотрудника (см.
    // operator-branding-chrome.tsx).
    accentScheme: tenant?.accentScheme ?? "green",
    // Ширина рулона/тип принтера — с УСТРОЙСТВА, не с тенанта (запрос
    // пользователя 2026-07-26: печать физически привязана к конкретному
    // принтеру этого устройства, не к бизнесу целиком).
    receiptPaperWidth: ctx.device.receiptPaperWidth,
    // Кто напечатал квитанцию (запрос пользователя 2026-07-20: "должно быть
    // и имя сотрудника или Владелец" рядом со строкой даты) — имя Сотрудника,
    // Владелец печатает с другого экрана и подставляет статичный ярлык
    // "Владелец" сам, без похода на этот роут.
    operatorName: ctx.operator.name,
  });
}
