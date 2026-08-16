import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

/**
 * Реестр продаж абонементов (запрос владельца 2026-08-16) — таб "Продажи" в
 * модуле Клиенты. До сих пор продажи было видно только в Итогах дня, по
 * одному дню и без возможности что-либо исправить.
 *
 * Источник — AbonementTransaction type="topup": только у неё есть
 * одновременно клиент, план и исполнитель. Уплаченные ДЕНЬГИ приходят из
 * связанных MoneyOperation (с 2026-08-16 связь прямая, см. миграцию
 * 20260816050000): это другая сумма, чем начисленная — у плана может быть
 * бонус "заплати 1000 — получи 1200". Показываем обе.
 */
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pointId = searchParams.get("pointId");
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to");
  // "owner" — продажи, проведённые владельцем из кабинета (у них нет
  // operatorId, поэтому отдельным значением, а не id).
  const performedBy = searchParams.get("performedBy");
  const planId = searchParams.get("planId");
  const q = (searchParams.get("q") ?? "").trim();

  const occurredAt: { gte?: Date; lt?: Date } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) occurredAt.gte = new Date(`${from}T00:00:00.000Z`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    occurredAt.lt = end;
  }

  const sales = await prisma.abonementTransaction.findMany({
    where: {
      // "adjustment" — начисление владельцем из кабинета (запрос 2026-08-16):
      // денег в кассу не приносит, но баланс клиента меняет ровно так же, и
      // видеть его владелец должен в том же реестре.
      type: { in: ["topup", "adjustment"] },
      wallet: {
        tenantId: owner.tenantId,
        // Поиск по клиенту — имя или телефон, как в списке Клиентов.
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] } : {}),
      },
      ...(pointId ? { pointId } : {}),
      ...(planId ? { abonementId: planId } : {}),
      ...(performedBy === "owner"
        ? { userId: { not: null } }
        : performedBy
          ? { operatorId: performedBy }
          : {}),
      ...(occurredAt.gte || occurredAt.lt ? { occurredAt } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: 300,
    include: {
      abonement: { select: { name: true } },
      // balance — чтобы на подтверждении предупредить, что аннулирование
      // уведёт клиента в минус (решение владельца 2026-08-16: предупредить,
      // но разрешить).
      wallet: { select: { id: true, name: true, phone: true, balance: true } },
      point: { select: { name: true } },
      operator: { select: { name: true, colorTag: true } },
      user: { select: { id: true } },
      moneyOperations: { select: { amount: true, type: true } },
    },
  });

  // Итог по отфильтрованному списку. Начисления владельца (type=adjustment)
  // в продажи НЕ входят вовсе — ни в счёт, ни в сумму, ни в "начислено"
  // (правка владельца 2026-08-16: "это же подарок"): денег за ними нет, и
  // смешивать подаренный баланс с проданным — значит завышать и то, и
  // другое. Они считаются отдельно, своей строкой.
  const totals = sales.reduce(
    (acc, s) => {
      if (s.voidedAt) return acc; // аннулированные в итог не входят
      if (s.type === "adjustment") {
        acc.giftCount += 1;
        acc.gifted += Number(s.amount);
        return acc;
      }
      acc.count += 1;
      acc.credited += Number(s.amount);
      acc.paid += s.moneyOperations
        .filter((op) => Number(op.amount) > 0)
        .reduce((sum, op) => sum + Number(op.amount), 0);
      return acc;
    },
    { count: 0, paid: 0, credited: 0, giftCount: 0, gifted: 0 }
  );

  return NextResponse.json({
    totals: {
      count: totals.count,
      paid: Math.round(totals.paid * 100) / 100,
      credited: Math.round(totals.credited * 100) / 100,
      giftCount: totals.giftCount,
      gifted: Math.round(totals.gifted * 100) / 100,
    },
    sales: sales.map((s) => {
      // Уплачено = сумма связанных операций (при разбивке их несколько).
      // Компенсации аннулирования тоже связаны с этой продажей и приходят
      // отрицательными — поэтому берём модуль от суммы положительных.
      const paid = s.moneyOperations
        .filter((op) => Number(op.amount) > 0)
        .reduce((sum, op) => sum + Number(op.amount), 0);
      return {
        id: s.id,
        occurredAt: s.occurredAt.toISOString(),
        // "adjustment" — начисление владельцем, у него нет ни плана, ни
        // денег: экран показывает его отдельной пометкой, а не как продажу.
        kind: s.type === "adjustment" ? ("adjustment" as const) : ("sale" as const),
        planName: s.abonement?.name ?? null,
        creditedAmount: Number(s.amount),
        // null — старая продажа без связи с деньгами (см. бэкфилл миграции):
        // экран показывает прочерк, а не выдуманную сумму.
        paidAmount: s.moneyOperations.length > 0 ? paid : null,
        paymentMethod: s.paymentMethod,
        // Методы оплаты для иконок в строке (запрос владельца 2026-08-16):
        // при разбивке их два — часть наличными, часть безналом. Берём из
        // связанных операций, а не из paymentMethod: там у разбивки лежит
        // "split", по которому конкретные методы не восстановить.
        methods: (() => {
          const fromOps = [...new Set(
            s.moneyOperations
              .filter((op) => Number(op.amount) > 0)
              .map((op) => (op.type === "abonement_topup_cashless" ? "mobile" : "cash"))
          )];
          if (fromOps.length > 0) return fromOps;
          // Старые записи без связи с деньгами и начисления владельца.
          return s.paymentMethod && s.paymentMethod !== "split" ? [s.paymentMethod] : [];
        })(),
        walletId: s.wallet.id,
        clientName: s.wallet.name,
        clientPhone: s.wallet.phone,
        walletBalance: Number(s.wallet.balance),
        pointName: s.point?.name ?? null,
        performedBy: s.operator?.name ?? null,
        // Email владельца наружу не отдаём — только флаг (тот же приём, что
        // в abonement-wallets/[id]).
        performedByOwner: !!s.user,
        performedByColorTag: s.operator?.colorTag ?? null,
        voidedAt: s.voidedAt?.toISOString() ?? null,
      };
    }),
  });
}
