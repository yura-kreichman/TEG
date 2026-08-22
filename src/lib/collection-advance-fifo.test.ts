import { describe, expect, it } from "vitest";

// Логика "какие Авансы инкассации ещё не погашены" из
// settleOutstandingCollectionAdvance (src/lib/zone-balance.ts). Вынесена сюда
// копией намеренно: сама функция ходит в базу внутри транзакции, а проверять
// нужно именно правило FIFO, ради которого её и переписали 2026-08-22.
function openAdvances(ops: { id: string; amount: number }[]): string[] {
  const debts: { id: string; left: number }[] = [];
  for (const op of ops) {
    if (op.amount < 0) {
      debts.push({ id: op.id, left: -op.amount });
      continue;
    }
    let repay = op.amount;
    for (const debt of debts) {
      if (repay <= 0) break;
      const covered = Math.min(debt.left, repay);
      debt.left = Math.round((debt.left - covered) * 100) / 100;
      repay = Math.round((repay - covered) * 100) / 100;
    }
  }
  return debts.filter((d) => d.left > 0).map((d) => d.id);
}

describe("непогашенные Авансы инкассации", () => {
  it("погашенный аванс закрыт, даже если ссылка на него не проставлена", () => {
    // Реальная история КидсБурга: два цикла "взяли вперёд — погасили".
    // Прежняя логика (по наличию ссылки) считала открытыми оба и навсегда
    // блокировала правку суммы инкассации.
    expect(
      openAdvances([
        { id: "aug19", amount: -1100 },
        { id: "aug19-settle", amount: 1100 },
        { id: "aug22", amount: -110 },
        { id: "aug22-settle", amount: 110 },
      ])
    ).toEqual([]);
  });

  it("незакрытый остаток виден, и связь ставится именно на него", () => {
    expect(
      openAdvances([
        { id: "old", amount: -1100 },
        { id: "old-settle", amount: 1100 },
        { id: "fresh", amount: -110 },
      ])
    ).toEqual(["fresh"]);
  });

  it("частичное погашение по FIFO закрывает первый долг раньше второго", () => {
    expect(
      openAdvances([
        { id: "first", amount: -100 },
        { id: "second", amount: -50 },
        { id: "settle", amount: 120 },
      ])
    ).toEqual(["second"]);
  });

  it("два открытых долга — связь не ставится (делить погашение было бы гаданием)", () => {
    expect(
      openAdvances([
        { id: "first", amount: -100 },
        { id: "second", amount: -50 },
      ])
    ).toEqual(["first", "second"]);
  });
});
