import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantPoint, requireOwner } from "@/lib/require-owner";
import { dispatchCollection } from "@/lib/summary-channels/dispatch";
import { getPointAbonementCashTotal, getPointGoodsCashTotal } from "@/lib/zone-balance";
import { formatMoney } from "@/lib/format";
import { resolveLocale } from "@/lib/i18n";

// Инкассация "Абонементы"/"Товары" наличными точки — явный выбор цели в
// дропдауне "По зонам" (запрос пользователя 2026-07-22). Эти деньги не
// привязаны ни к одной зоне (lib/zone-balance.ts, getPointAbonementCashTotal/
// getPointGoodsCashTotal), поэтому свой роут, не /api/zones/[id]/collection.
//
// С ПОТОЛКОМ, в отличие от зонной инкассации — реальный баг/недодуманная
// логика, найдено пользователем 2026-07-25: у зон "честный минус" оправдан
// тем, что выручка попадает в систему только на Сдаче итогов — между "деньги
// реально у сотрудника" и "система о них узнала" есть законный разрыв,
// забрать вперёд не дожидаясь сдачи — легитимный сценарий. У Абонементов и
// Товаров такого разрыва НЕТ ВООБЩЕ: продажа создаёт запись в кассе В ТОТ ЖЕ
// МОМЕНТ, никакой отложенной "сдачи" для них не существует —
// getPointAbonementCashTotal/getPointGoodsCashTotal ВСЕГДА точно отражают,
// сколько реально несобранных наличных там лежит. Забрать больше — нечего,
// это не "аванс под будущую выручку", это просто ошибка ввода.
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/collection/pool">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId } = await ctx.params;
  const point = await findTenantPoint(owner.tenantId, pointId);
  if (!point) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { pool, amount } = await request.json();
  if (pool !== "abonement" && pool !== "goods") {
    return NextResponse.json({ error: "Некорректный пул" }, { status: 400 });
  }
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const available = await (pool === "abonement" ? getPointAbonementCashTotal(pointId) : getPointGoodsCashTotal(pointId));
  if (amountNumber > available) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Сумма превышает остаток наличных (${formatMoney(available, locale)})` },
      { status: 400 }
    );
  }

  await prisma.moneyOperation.create({
    data: {
      tenantId: owner.tenantId,
      pointId,
      type: pool === "abonement" ? "collection_pool_sweep_abonement" : "collection_pool_sweep_goods",
      amount: -amountNumber,
      performedByUserId: owner.user.id,
    },
  });

  dispatchCollection(owner.tenantId, amountNumber, point.name, null).catch(() => {});

  return NextResponse.json({ ok: true });
}
