import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { normalizePhone } from "@/lib/abonement";

// Список кошельков клиентов тенанта (запрос пользователя 2026-07-17:
// "у владельца так и не виден список активных абонентов") — read-only обзор
// для владельца: посмотреть/найти клиента и его баланс. Отдельный роут от
// /api/abonement-wallets (тот — точный поиск по телефону для потока продажи/
// пополнения, другая форма ответа), не смешиваем.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const phoneQuery = q ? normalizePhone(q) : "";
  // Сортировка (запрос пользователя 2026-07-18: "по балансу, активности и
  // стажу") — "balance"/"activity"/"tenure", по умолчанию — как раньше,
  // недавно созданные сверху.
  const sort = searchParams.get("sort");

  const wallets = await prisma.abonementWallet.findMany({
    where: {
      tenantId: owner.tenantId,
      ...(q
        ? {
            OR: [
              ...(phoneQuery ? [{ phone: { contains: phoneQuery } }] : []),
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    // Без take здесь — сортировка "по балансу"/"по активности" должна
    // применяться ко всем найденным кошелькам ДО обрезки списка, иначе
    // "топ по балансу" на самом деле был бы топом только среди недавно
    // созданных 100.
  });

  const walletIds = wallets.map((w) => w.id);
  const lastActivityByWallet = walletIds.length
    ? await prisma.abonementTransaction.groupBy({
        by: ["walletId"],
        where: { walletId: { in: walletIds } },
        _max: { occurredAt: true },
      })
    : [];
  const lastActivityMap = new Map(lastActivityByWallet.map((a) => [a.walletId, a._max.occurredAt]));

  const list = wallets.map((w) => ({
    id: w.id,
    phone: w.phone,
    name: w.name,
    balance: Number(w.balance),
    createdAt: w.createdAt,
    // Нет ни одной операции — активность считается по дате создания
    // кошелька (запрос пользователя 2026-07-17: можно завести абонента без
    // покупки плана, тогда транзакций ещё нет вовсе).
    lastActivityAt: lastActivityMap.get(w.id) ?? w.createdAt,
  }));

  if (sort === "balance") {
    list.sort((a, b) => b.balance - a.balance);
  } else if (sort === "activity") {
    list.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  } else if (sort === "tenure") {
    // Больший стаж — дата создания раньше (запись "с нами дольше" сверху).
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  } else {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return NextResponse.json({ wallets: list.slice(0, 100) });
}
