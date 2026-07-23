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

  // Читаем остаток и пишем инкассацию под локом одной транзакцией — тот же
  // класс гонки, что уже закрыт для zone/general-инкассации и авансов
  // (аудит 2026-07-24: этот роут и operator-версия добавлены 2026-07-22, уже
  // ПОСЛЕ ретрофита локов на остальные роуты инкассации, и остались не
  // покрыты — двойной клик читал один и тот же "остаток" дважды и списывал
  // дважды).
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pointId}))`;
    const freshAvailable = await (pool === "abonement"
      ? getPointAbonementCashTotal(pointId, tx)
      : getPointGoodsCashTotal(pointId, tx));
    if (amountNumber > freshAvailable) {
      return { ok: false as const, available: freshAvailable };
    }
    await tx.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId,
        type: pool === "abonement" ? "collection_pool_sweep_abonement" : "collection_pool_sweep_goods",
        amount: -amountNumber,
        performedByUserId: owner.user.id,
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

  dispatchCollection(owner.tenantId, amountNumber, point.name, null).catch(() => {});

  return NextResponse.json({ ok: true });
}
