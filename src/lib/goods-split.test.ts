import { describe, expect, it } from "vitest";
import { allocateLegsAcrossItems } from "./goods";

// Раскладка долей оплаты корзины по позициям обязана сходиться В ОБЕ стороны:
// по позиции — чтобы аннулирование одной вернуло ровно её часть; по методу —
// чтобы с кошелька клиента списалось ровно то, что ввёл оператор. Прежняя
// версия держала только первое, и копейка, отобранная у безнала в одной
// позиции, никому не возвращалась (генеральная проверка финансов 2026-09-02).

const cents = (v: number) => Math.round(v * 100);

function check(legs: { method: string; amount: number; walletId?: string }[], items: number[]) {
  const grid = allocateLegsAcrossItems(legs as never, items);

  items.forEach((item, i) => {
    const rowSum = grid[i]!.reduce((s, l) => s + cents(l.amount), 0);
    expect({ item: i, sum: rowSum }).toEqual({ item: i, sum: cents(item) });
  });

  legs.forEach((leg) => {
    const colSum = grid.reduce(
      (s, row) => s + row.filter((l) => l.method === leg.method).reduce((a, l) => a + cents(l.amount), 0),
      0
    );
    expect({ method: leg.method, sum: colSum }).toEqual({ method: leg.method, sum: cents(leg.amount) });
  });

  for (const row of grid) for (const l of row) expect(l.amount).toBeGreaterThan(0);
}

describe("allocateLegsAcrossItems", () => {
  it("три позиции, две доли — некруглые копейки", () => {
    check(
      [
        { method: "cash", amount: 33.34 },
        { method: "abonement", amount: 66.66, walletId: "w1" },
      ],
      [33.33, 33.33, 33.34]
    );
  });

  it("одна доля покрывает всё", () => {
    check([{ method: "abonement", amount: 100, walletId: "w1" }], [10, 20, 70]);
  });

  it("три доли и семь позиций — худший случай накопления остатка", () => {
    check(
      [
        { method: "cash", amount: 10.01 },
        { method: "mobile", amount: 10.01 },
        { method: "abonement", amount: 9.98, walletId: "w1" },
      ],
      [1.43, 4.29, 0.07, 8.58, 2.86, 5.72, 7.05]
    );
  });

  it("позиция с нулевой суммой не получает долей", () => {
    const grid = allocateLegsAcrossItems(
      [
        { method: "cash", amount: 50 },
        { method: "mobile", amount: 50 },
      ] as never,
      [0, 100]
    );
    expect(grid[0]).toEqual([]);
    expect(grid[1]!.reduce((s, l) => s + cents(l.amount), 0)).toBe(10000);
  });

  it("доля с нулевой суммой не создаёт пустых строк", () => {
    check(
      [
        { method: "cash", amount: 100 },
        { method: "mobile", amount: 0 },
      ],
      [40, 60]
    );
  });
});
