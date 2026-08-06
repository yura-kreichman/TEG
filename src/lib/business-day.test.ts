import { describe, expect, it } from "vitest";
import { businessDayOf, dayBoundsUtc, periodBoundsUtc } from "./business-day";

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

// --- Граница дня в кабинете (решение пользователя 2026-08-06) ---
//
// Точка, закрывающаяся в три ночи: касса и показания снимаются ОДИН раз, при
// сдаче. По календарному дню весь вечер уезжал в следующую дату — суббота
// пустая, воскресенье двойное, сверка кассы превращалась в мусор.

const NIGHT = "06:00"; // "работаем после полуночи"

describe("dayBoundsUtc с границей дня", () => {
  it("день идёт от границы до границы, а не от полуночи", () => {
    const { start, end } = dayBoundsUtc(2026, 8, 8, CHISINAU, NIGHT);
    // 8 августа 06:00 в Кишинёве (+3) = 03:00 UTC.
    expect(start.toISOString()).toBe("2026-08-08T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-09T03:00:00.000Z");
  });

  it("сдача в 02:40 ночи попадает в предыдущий день, где её и заработали", () => {
    // Суббота 8 августа, закрылись в 02:40 воскресенья = 23:40 UTC субботы.
    const submission = new Date("2026-08-08T23:40:00.000Z");
    const saturday = dayBoundsUtc(2026, 8, 8, CHISINAU, NIGHT);
    const sunday = dayBoundsUtc(2026, 8, 9, CHISINAU, NIGHT);

    expect(submission >= saturday.start && submission < saturday.end).toBe(true);
    expect(submission >= sunday.start && submission < sunday.end).toBe(false);
  });

  it("по календарному дню та же сдача уехала бы в воскресенье — фиксируем разницу", () => {
    const submission = new Date("2026-08-08T23:40:00.000Z");
    const saturdayCalendar = dayBoundsUtc(2026, 8, 8, CHISINAU);
    expect(submission < saturdayCalendar.end).toBe(false);
  });

  it("без границы поведение прежнее — полночь по месту", () => {
    const { start } = dayBoundsUtc(2026, 8, 8, CHISINAU);
    expect(start.toISOString()).toBe("2026-08-07T21:00:00.000Z");
  });
});

describe("businessDayOf", () => {
  it("отвечает согласованно с dayBoundsUtc", () => {
    const submission = new Date("2026-08-08T23:40:00.000Z"); // 02:40 воскресенья по месту
    const { year, month, day } = businessDayOf(submission, CHISINAU, NIGHT);
    expect({ year, month, day }).toEqual({ year: 2026, month: 8, day: 8 });

    const bounds = dayBoundsUtc(year, month, day, CHISINAU, NIGHT);
    expect(submission >= bounds.start && submission < bounds.end).toBe(true);
  });

  it("вечер до полуночи остаётся своим днём", () => {
    const evening = new Date("2026-08-08T19:10:00.000Z"); // 22:10 субботы по месту
    expect(businessDayOf(evening, CHISINAU, NIGHT)).toEqual({ year: 2026, month: 8, day: 8 });
  });

  it("утро после границы — уже новый день", () => {
    const morning = new Date("2026-08-09T04:00:00.000Z"); // 07:00 воскресенья по месту
    expect(businessDayOf(morning, CHISINAU, NIGHT)).toEqual({ year: 2026, month: 8, day: 9 });
  });

  it("без границы совпадает с календарной датой по месту", () => {
    const nightOwl = new Date("2026-08-08T23:40:00.000Z"); // 02:40 воскресенья
    expect(businessDayOf(nightOwl, CHISINAU)).toEqual({ year: 2026, month: 8, day: 9 });
  });
});

describe("границы месяца при ночной работе", () => {
  it("ночная смена 31-го числа не уезжает в следующий месяц", () => {
    // Закрылись в 01:30 первого сентября = 22:30 UTC 31 августа.
    const submission = new Date("2026-08-31T22:30:00.000Z");
    const august = periodBoundsUtc("2026-08-01", "2026-08-31", CHISINAU, NIGHT);
    const september = periodBoundsUtc("2026-09-01", "2026-09-30", CHISINAU, NIGHT);

    expect(submission >= august.from && submission < august.to).toBe(true);
    expect(submission >= september.from && submission < september.to).toBe(false);
  });
});
