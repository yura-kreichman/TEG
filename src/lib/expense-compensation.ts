import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export interface DayExpense {
  id: string;
  zoneId: string;
  amount: number;
  occurredAt: Date;
}

export interface ExpenseCompensation {
  /** Все непривязанные расходы точки за окно — сдача итогов забирает их себе целиком. */
  all: DayExpense[];
  /** Те, что возвращаются в выручку: деньги на них ещё лежат в кассе сотрудника. */
  compensableIds: Set<string>;
  /** Сумма компенсации по зонам — то, что прибавляется к введённому остатку. */
  compensatedByZone: Map<string, number>;
}

/**
 * Какие расходы периода возвращаются в выручку при сдаче итогов.
 *
 * Сотрудник вводит в кассу ОСТАТОК — деньги на расход уже вышли (решение
 * владельца 2026-08-16), поэтому потраченное сдача прибавляет обратно, иначе
 * расход вычтется дважды: внутри введённой суммы и операцией расхода.
 *
 * Но не всякий расход дня оплачен деньгами, которые ещё в ящике. Если посреди
 * дня приезжал владелец и забрал кассу, расход, сделанный ДО его приезда,
 * уехал вместе с ней — возвращать его в вечернюю выручку нельзя, остаток
 * зоны окажется завышен ровно на его сумму (найдено на живых данных
 * КидсБурга 22.08.2026).
 *
 * Исключение — "Аванс инкассации" (docs/spec/02-money.md): владелец забрал
 * БОЛЬШЕ, чем числилось в зонах, то есть в пачке уехали и деньги, которые
 * система уже считала потраченными. Такой аванс погашается из выручки этой же
 * сдачи (settleOutstandingCollectionAdvance), и без компенсации расход
 * списался бы дважды — сам собой и погашением аванса. Поэтому расходы до
 * инкассации компенсируются, но не больше суммы, взятой сверх кассы, и
 * только целиком: половина расхода в такой арифметике смысла не имеет.
 *
 * Один источник правды для трёх мест: сдача итогов (api/operator/submit-results),
 * список расходов у сотрудника (api/operator/zone-expense-events) и Разница,
 * которую PWA считает на экране до отправки. Раньше клиент считал её вообще
 * без расходов — экран показывал недостачу ровно на сумму трат, хотя у
 * сотрудника всё сходилось.
 */
export async function getExpenseCompensation(
  pointId: string,
  windowStart: Date,
  now: Date,
  client: Tx | typeof prisma = prisma
): Promise<ExpenseCompensation> {
  const [rawExpenses, collections, advanceOps] = await Promise.all([
    client.moneyOperation.findMany({
      where: {
        type: "expense",
        resultsSubmissionId: null,
        zone: { pointId },
        occurredAt: { gte: windowStart, lte: now },
      },
      select: { id: true, zoneId: true, amount: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    client.moneyOperation.findMany({
      where: { type: "collection", zone: { pointId }, occurredAt: { gte: windowStart, lte: now } },
      select: { zoneId: true, occurredAt: true },
    }),
    client.moneyOperation.findMany({
      where: { pointId, type: "collection_advance", occurredAt: { gte: windowStart, lte: now } },
      select: { amount: true },
    }),
  ]);

  const all: DayExpense[] = rawExpenses
    .filter((op): op is typeof op & { zoneId: string } => op.zoneId !== null)
    .map((op) => ({
      id: op.id,
      zoneId: op.zoneId,
      amount: Math.abs(Number(op.amount)),
      occurredAt: op.occurredAt,
    }));

  const lastCollectionByZone = new Map<string, Date>();
  for (const op of collections) {
    if (!op.zoneId) continue;
    const known = lastCollectionByZone.get(op.zoneId);
    if (!known || op.occurredAt > known) lastCollectionByZone.set(op.zoneId, op.occurredAt);
  }

  // Хранится отрицательным (деньги покинули точку), погашения — плюсом:
  // сумма по окну и есть "сколько ещё взято сверх кассы и не разнесено".
  let advanceBudget = Math.max(0, -advanceOps.reduce((sum, op) => sum + Number(op.amount), 0));

  const compensableIds = new Set<string>();
  const compensatedByZone = new Map<string, number>();
  // По возрастанию времени — детерминированный порядок раздачи бюджета
  // аванса, одинаковый во всех трёх местах, где считается эта величина.
  for (const expense of all) {
    const cutoff = lastCollectionByZone.get(expense.zoneId);
    const afterCollection = !cutoff || expense.occurredAt >= cutoff;
    if (!afterCollection) {
      if (advanceBudget < expense.amount) continue;
      advanceBudget = Math.round((advanceBudget - expense.amount) * 100) / 100;
    }
    compensableIds.add(expense.id);
    compensatedByZone.set(
      expense.zoneId,
      Math.round(((compensatedByZone.get(expense.zoneId) ?? 0) + expense.amount) * 100) / 100
    );
  }

  return { all, compensableIds, compensatedByZone };
}
