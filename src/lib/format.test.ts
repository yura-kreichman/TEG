import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("целое значение — без дробной части", () => {
    expect(formatMoney(35)).toBe("35");
  });

  it("дробное значение — ровно 2 знака", () => {
    expect(formatMoney(35.5)).toBe("35,50");
  });

  it("округляет до 2 знаков", () => {
    expect(formatMoney(257.644)).toBe("257,64");
  });

  it("ноль — без дробной части", () => {
    expect(formatMoney(0)).toBe("0");
  });

  it("отрицательное значение", () => {
    expect(formatMoney(-12.3)).toBe("-12,30");
  });

  it("группировка тысяч (NBSP — реальный разделитель Intl для ru)", () => {
    expect(formatMoney(1234.5)).toBe("1 234,50");
  });

  it("значение, округляющееся до целого, теряет дробную часть", () => {
    expect(formatMoney(35.001)).toBe("35");
  });

  it("локаль en — точка вместо запятой, обычный пробел не требуется на этой сумме", () => {
    expect(formatMoney(35.5, "en")).toBe("35.50");
  });
});
