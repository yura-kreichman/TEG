import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { dispatchCollection } from "@/lib/summary-channels/dispatch";
import { getPointAbonementCashTotal, getPointGoodsCashTotal } from "@/lib/zone-balance";
import { formatMoney } from "@/lib/format";
import { resolveLocale } from "@/lib/i18n";

// Инкассация "Абонементы"/"Товары" наличными точки, вносит Сотрудник — см.
// owner-версию (/api/points/[id]/collection/pool) для полного объяснения, в
// т.ч. почему тут (в отличие от зонной инкассации) есть потолок.
export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }

  const { pool, amount } = await request.json();
  if (pool !== "abonement" && pool !== "goods") {
    return NextResponse.json({ error: "Некорректный пул" }, { status: 400 });
  }
  // "Товары" — только с тумблером goodsAccess (docs/spec/09-goods.md,
  // "Доступ"), тот же принцип, что и у продажи товаров — не все сотрудники
  // имеют доступ (запрос пользователя 2026-07-22). Проверка на сервере, не
  // только скрытие в UI — дропдаун не показывает этот пункт без тумблера, но
  // прямой запрос всё равно должен отклоняться.
  if (pool === "goods" && !ctx.operator.goodsAccess) {
    return NextResponse.json({ error: "Нет доступа к Товарам" }, { status: 403 });
  }
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  // Тот же лок, что у owner-версии (аудит 2026-07-24) — двойной клик/гонка
  // владелец+оператор больше не читают устаревший остаток дважды.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.point.id}))`;
    const freshAvailable = await (pool === "abonement"
      ? getPointAbonementCashTotal(ctx.point.id, tx)
      : getPointGoodsCashTotal(ctx.point.id, tx));
    if (amountNumber > freshAvailable) {
      return { ok: false as const, available: freshAvailable };
    }
    await tx.moneyOperation.create({
      data: {
        tenantId: ctx.point.tenantId,
        pointId: ctx.point.id,
        type: pool === "abonement" ? "collection_pool_sweep_abonement" : "collection_pool_sweep_goods",
        amount: -amountNumber,
        performedByOperatorId: ctx.operator.id,
      },
    });
    return { ok: true as const };
  });
  if (!result.ok) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Сумма превышает остаток наличных (${formatMoney(result.available, locale)})` },
      { status: 400 }
    );
  }

  dispatchCollection(ctx.point.tenantId, amountNumber, ctx.point.name, ctx.operator.name).catch(() => {});

  return NextResponse.json({ ok: true });
}
