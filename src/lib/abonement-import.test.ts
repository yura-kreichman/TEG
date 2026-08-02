import { describe, expect, it } from "vitest";
import { analyzeImportRows } from "./abonement-import";

// Разбор файла из чужой системы — единственное место, где посторонние данные
// превращаются в клиентов с деньгами. Ошибка тут либо теряет клиента, либо
// заводит ему чужой баланс, поэтому проверяется построчно.

const HEADER = ["Phone", "", "Name", "Balance"];

function analyze(rows: unknown[][], existing: string[] = []) {
  return analyzeImportRows(rows, new Set(existing));
}

describe("analyzeImportRows", () => {
  it("родной формат экспорта разбирается целиком", () => {
    const { rows, newCount, errorCount } = analyze([
      HEADER,
      ["+79991234567", "", "Анна", 1200.5],
      ["+79997654321", "", "Борис", 0],
    ]);
    expect(newCount).toBe(2);
    expect(errorCount).toBe(0);
    expect(rows[0]).toMatchObject({ phone: "79991234567", name: "Анна", balance: 1200.5, error: null });
    expect(rows[1]).toMatchObject({ phone: "79997654321", balance: 0, error: null });
  });

  it("файл без строки заголовков не теряет первого клиента", () => {
    const { rows, newCount } = analyze([["+79991234567", "", "Анна", 100]]);
    expect(newCount).toBe(1);
    expect(rows[0]!.line).toBe(1);
  });

  it("номер строки указывает на строку файла, как её видит Excel", () => {
    const { rows } = analyze([HEADER, ["+79991234567", "", "Анна", 100]]);
    expect(rows[0]!.line).toBe(2);
  });

  describe("баланс из чужих выгрузок", () => {
    const cases: [string, unknown, number][] = [
      ["число", 1200.5, 1200.5],
      ["запятая как разделитель", "1200,50", 1200.5],
      ["пробелы в тысячах", "1 200,50", 1200.5],
      ["символ валюты", "1200.50 ₽", 1200.5],
      ["точки в тысячах", "1.200,50", 1200.5],
      ["пустая ячейка — ноль", "", 0],
    ];
    for (const [label, raw, expected] of cases) {
      it(label, () => {
        const { rows } = analyze([HEADER, ["+79991234567", "", "Анна", raw]]);
        expect(rows[0]!.balance).toBe(expected);
        expect(rows[0]!.error).toBeNull();
      });
    }
  });

  it("нечитаемый баланс — ошибка, а не молчаливый ноль", () => {
    const { rows, errorCount } = analyze([HEADER, ["+79991234567", "", "Анна", "нет данных"]]);
    expect(rows[0]!.error).toBe("balance");
    expect(errorCount).toBe(1);
  });

  it("отрицательный баланс отклоняется", () => {
    const { rows } = analyze([HEADER, ["+79991234567", "", "Анна", -50]]);
    expect(rows[0]!.error).toBe("balance");
  });

  it("мусор вместо телефона отклоняется", () => {
    const { rows } = analyze([HEADER, ["—", "", "Анна", 100]]);
    expect(rows[0]!.error).toBe("phone");
  });

  it("разное написание одного номера — дубликат внутри файла", () => {
    const { rows, newCount } = analyze([
      HEADER,
      ["+7 999 123-45-67", "", "Анна", 100],
      ["79991234567", "", "Анна ещё раз", 500],
    ]);
    expect(rows[1]!.error).toBe("duplicateInFile");
    expect(newCount).toBe(1);
  });

  it("уже существующий клиент пропускается, а не задваивается", () => {
    const { rows, newCount, errorCount } = analyze([HEADER, ["+79991234567", "", "Анна", 100]], ["79991234567"]);
    expect(rows[0]!.error).toBe("alreadyExists");
    expect(newCount).toBe(0);
    // Существующий клиент — ожидаемый исход переезда, не ошибка владельца.
    expect(errorCount).toBe(0);
  });

  it("пустые хвостовые строки Excel игнорируются молча", () => {
    const { rows, newCount, errorCount } = analyze([HEADER, ["+79991234567", "", "Анна", 100], ["", "", "", ""], [], ["", null, "", null]]);
    expect(rows).toHaveLength(1);
    expect(newCount).toBe(1);
    expect(errorCount).toBe(0);
  });

  it("имя необязательно", () => {
    const { rows } = analyze([HEADER, ["+79991234567", "", "", 100]]);
    expect(rows[0]).toMatchObject({ name: null, error: null });
  });
});
