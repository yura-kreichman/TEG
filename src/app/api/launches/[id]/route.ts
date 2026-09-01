import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";

/**
 * Пометка на браслете — своя подпись поверх номера (запрос пользователя
 * 2026-09-01: «привязывать не обязательно клиента, а произвольный текст типа
 * "Максим в зелёной футболке"»).
 *
 * Поле Launch.label существует с 16 июля («опциональная короткая метка при
 * старте») и уже принимается стартом пуска (/api/zones/[id]/launches, там же
 * обрезка в 60 символов) — не хватало только способа поставить её ПОСЛЕ
 * старта, а именно тогда сотрудник и понимает, кого записал. Ровно тот же
 * роут и та же семантика, что переименование отложенного заказа Товаров
 * (/api/operator/goods/held-orders/[id]): пустая строка — сброс к дефолтному
 * «Посетитель N» (label: null), не пустая строка в БД.
 *
 * Пометка НЕ связана с привязкой клиента и не исключает её: это два
 * независимых справочных поля, как label и linkedClientWalletId у
 * отложенного заказа. На способ оплаты и расчёт выручки не влияет ничто из
 * двух.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/launches/[id]">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = opCtx;
  const { id } = await ctx.params;

  const launch = await prisma.launch.findUnique({
    where: { id },
    select: { zoneId: true, zone: { select: { pointId: true, accountingMode: true } } },
  });
  if (!launch || launch.zone.pointId !== point.id) {
    return NextResponse.json({ error: "Пуск не найден" }, { status: 404 });
  }
  if (launch.zone.accountingMode !== "stays") {
    return NextResponse.json({ error: "Доступно только для «Прибываний»" }, { status: 400 });
  }
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: launch.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) {
      return NextResponse.json({ error: "Нет доступа к этой зоне" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  // Та же обрезка в 60 символов, что на старте пуска — иначе метка,
  // поставленная позже, могла бы оказаться длиннее той, что поставлена сразу.
  const label =
    typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;

  await prisma.launch.update({ where: { id }, data: { label } });
  return NextResponse.json({ label });
}
