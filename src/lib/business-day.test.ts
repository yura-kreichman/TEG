import { describe, expect, it } from "vitest";
import { periodBoundsUtc } from "./business-day";

// Границы недели/месяца в табеле Рабочего времени. До 2026-08-02 они брались
// сырой UTC-полночью, из-за чего у тенанта восточнее UTC ночная смена уезжала
// в соседний месяц вместе со своим начислением.

const CHISINAU = "Europe/Chisinau"; // UTC+2 зимой, UTC+3 летом

describe("periodBoundsUtc", () => {
  it("границы месяца — местная полночь, а не UTC", () => {
    const { from, to } = periodBoundsUtc("2026-08-01", "2026-08-31", CHISINAU);
    // 1 августа 00:00 в Кишинёве (+3) = 31 июля 21:00 UTC.
    expect(from.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    // Верхняя граница exclusive — местная полночь 1 сентября.
    expect(to.toISOString()).toBe("2026-08-31T21:00:00.000Z");
  });

  it("смена, начатая в 00:30 по месту 1 августа, попадает в август", () => {
    const shiftStart = new Date("2026-07-31T21:30:00.000Z"); // 00:30 1 августа в Кишинёве
    const august = periodBoundsUtc("2026-08-01", "2026-08-31", CHISINAU);
    const july = periodBoundsUtc("2026-07-01", "2026-07-31", CHISINAU);

    expect(shiftStart >= august.from && shiftStart < august.to).toBe(true);
    expect(shiftStart >= july.from && shiftStart < july.to).toBe(false);
  });

  it("та же смена при сыром UTC уехала бы в июль — фиксируем разницу", () => {
    const shiftStart = new Date("2026-07-31T21:30:00.000Z");
    const naiveAugustFrom = new Date("2026-08-01T00:00:00.000Z");
    // Ровно то поведение, которое чинили: по UTC-границе смена в август не попадает.
    expect(shiftStart >= naiveAugustFrom).toBe(false);
  });

  it("UTC-тенант получает ровно UTC-полночь", () => {
    const { from, to } = periodBoundsUtc("2026-08-01", "2026-08-31", "UTC");
    expect(from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("переход на зимнее время внутри периода не ломает границы", () => {
    // Кишинёв переходит на зимнее время в последнее воскресенье октября:
    // начало октября ещё +3, конец — уже +2.
    const { from, to } = periodBoundsUtc("2026-10-01", "2026-10-31", CHISINAU);
    expect(from.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-31T22:00:00.000Z");
  });

  it("неделя, пересекающая границу месяца", () => {
    const { from, to } = periodBoundsUtc("2026-07-27", "2026-08-02", CHISINAU);
    expect(from.toISOString()).toBe("2026-07-26T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-02T21:00:00.000Z");
  });
});
