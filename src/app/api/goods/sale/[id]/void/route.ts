import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { voidGoodsSale } from "@/lib/goods";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Аннулирование продажи — только владелец (docs/spec/09-goods.md,
// "Аннулирование"). Оператор не может отменить ни одним способом оплаты.
export async function POST(request: Request, ctx: RouteContext<"/api/goods/sale/[id]/void">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "goodsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const reason: string | null = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  try {
    const voided = await voidGoodsSale(id, owner.tenantId, owner.user.id, reason);
    // Пересобираем «Кассу за день» (генеральная проверка финансов 2026-09-02).
    // Аннулирование пишет компенсирующую MoneyOperation с минусом, то есть
    // меняет остаток кассы точки — а именно его сводка показывает строкой
    // «Остаток на точке». Правка инкассации и расхода это давно делают, у
    // аннулирования товара вызова просто не было, и сообщение в чате
    // оставалось с прежним числом.
    //
    // Пересобирать надо ОБА дня, когда они разные: компенсирующая операция
    // пишется без occurredAt, то есть датой аннулирования, а не датой самой
    // продажи. При отмене вчерашней продажи менялся остаток и вчерашней
    // сводки (ушла выручка), и сегодняшней (пришёл минус) — а звался только
    // день продажи.
    const voidedAtDay = new Date();
    for (const at of [voided.occurredAt, voidedAtDay]) {
      await resyncAfterMoneyOpChange({
        tenantId: owner.tenantId,
        zoneId: null,
        pointId: voided.pointId,
        shiftId: null,
        occurredAt: at,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Продажа не найдена" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "ALREADY_VOIDED") {
      // 409, не 400 (аудит 2026-07-26) — та же CAS-гонка двойного клика, что
      // у /api/launches/[id]/void, /api/tickets/[id]/void, /api/ticket-orders/[id]/void
      // — везде остальных три "уже аннулировано" маппится в 409 (конфликт
      // состояния), этот роут был единственным выбросом на 400.
      return NextResponse.json({ error: "Продажа уже аннулирована" }, { status: 409 });
    }
    throw err;
  }
}
