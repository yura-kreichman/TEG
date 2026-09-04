import { NextResponse } from "next/server";
import { resyncAfterMoneyOpChange } from "@/lib/summary-channels/resync";
import { prisma } from "@/lib/prisma";
import { findTenantOperator, requireOwner } from "@/lib/require-owner";
import { calcOperatorBalance } from "@/lib/work-time";
import { resolveLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";

// Ручной аванс из карточки оператора (docs/spec/05-work-time.md,
// "ИНТЕРФЕЙС ВЛАДЕЛЬЦА") — не привязан к смене (shiftId остаётся null).
// Владелец не залогинен на устройство точки, поэтому кассу (pointId)
// указывает явно в запросе.
export async function POST(request: Request, ctx: RouteContext<"/api/operators/[id]/work-time/advance">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const operator = await findTenantOperator(owner.tenantId, id);
  if (!operator) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const { amount, pointId } = await request.json();
  const amountNumber = Math.abs(Number(amount));
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const point = await prisma.point.findUnique({ where: { id: pointId } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }

  // ДЕНЬГИ ИЗ КАРМАНА ВЛАДЕЛЬЦА, КАССЫ ТОЧКИ НЕ КАСАЮТСЯ (правило владельца
  // 2026-09-04: «все авансы и премии, которые вносит владелец, это из его
  // кармана и к остаткам по зоне значения не имеет»).
  //
  // Со 2 по 4 сентября здесь действовало обратное правило: выплата считалась
  // выданной из ящика и разносилась по зонам. Его поставили по случаю
  // КидсБурга, где владелец действительно доставал деньги из кассы, — но как
  // ОБЩЕЕ правило оно неверно и в тот же день сломало Керен Центр:
  //
  //   04.09 21:55  аванс Кате 6045,66 из карточки
  //                в кассах зон лежало 1719 — таких денег в ящике не было
  //                вовсе, последняя инкассация 1 сентября
  //                все пять зон ушли в минус
  //
  // Минус в зоне механизм сверки читает как «забрали до пересчёта» и вернул
  // бы эти 6045,66 в выручку следующей сдачи — то есть ошибка не осталась бы
  // косметической.
  //
  // Отличать «из ящика» от «из кармана» приложение не может, а спрашивать
  // владельца на каждой выплате он не захотел. Из двух правил верно это:
  // выплату из ящика сотрудник и так отмечает сам в PWA (self-service), где
  // она проверяется по остатку кассы, — а карточка сотрудника у владельца
  // остаётся для денег, которые он даёт от себя.
  //
  // Проверка остаётся по личному балансу сотрудника «к выдаче» + овердрафт, а
  // не по остатку кассы: у владельца рядом с ящиком свои резоны выдать вперёд,
  // и жёсткий кап тут не его случай. У самого сотрудника (self-service в PWA)
  // наоборот — без овердрафта, но строго по остатку кассы точки, см.
  // /api/operator/work-time/check-out и .../shifts.
  //
  // Advisory-лок по operatorId (аудит 2026-07-26) — раньше проверка баланса и
  // создание MoneyOperation были обычным read-then-write без блокировки, а
  // сама форма на карточке оператора не защищена от двойного клика/тапа:
  // два почти одновременных запроса читали один и тот же "к выдаче" и оба
  // проходили проверку — выплата реально задваивалась. Тот же приём, что уже
  // применён к кассе точки в operator/work-time/shifts/[id]/route.ts.
  const result = await prisma.$transaction(async (tx) => {
    // Лок только по сотруднику: касса точки больше не задействована, и
    // блокировать её незачем.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operator.id}))`;
    const balance = await calcOperatorBalance(operator.id, undefined, tx);
    if (!operator.overdraftAllowed && amountNumber > balance.toPayOut) {
      return { ok: false as const, toPayOut: balance.toPayOut };
    }
    await tx.moneyOperation.create({
      data: {
        tenantId: owner.tenantId,
        pointId: point.id,
        type: "advance",
        amount: -amountNumber,
        // Только performedByUserId: деньги не выходили из ящика, и
        // getPointCashBalance такую запись из остатка исключает. Получателя
        // держит beneficiaryOperatorId — личный баланс сотрудника считается
        // по нему, поэтому «к выдаче» уменьшается как и должно.
        performedByUserId: owner.user.id,
        beneficiaryOperatorId: operator.id,
      },
    });
    return { ok: true as const };
  });
  if (!result.ok) {
    const locale = await resolveLocale();
    return NextResponse.json(
      { error: `Аванс превышает доступный баланс к выдаче (${formatMoney(result.toPayOut, locale)})` },
      { status: 400 }
    );
  }

  // Пересобираем уже отправленные сводки (жалоба владельца 2026-09-02: «внёс
  // аванс и премию — это нигде не отобразилось»). Роуты карточки не звали
  // resync вообще, в отличие от расходов и инкассаций. Остаток кассы такая
  // выплата больше не двигает, но в сводке есть и другие блоки, где она
  // должна появиться. Тихо, через catch: сорванная отправка не повод отменять
  // уже проведённую выплату.
  await resyncAfterMoneyOpChange({
    tenantId: owner.tenantId,
    zoneId: null,
    pointId: point.id,
    shiftId: null,
    occurredAt: new Date(),
  }).catch(() => {});

  return NextResponse.json({ balance: await calcOperatorBalance(operator.id) });
}
