import { describe, expect, it } from "vitest";
import { aggregateOpenPrepaidLaunches, computeLaunchAmount, smallestFreeNumber } from "./game-room";

describe("smallestFreeNumber — номер браслета (docs/spec/04-game-room.md)", () => {
  it("пусто — первый номер 1", () => {
    expect(smallestFreeNumber([])).toBe(1);
  });
  it("1,2,3 заняты — следующий 4", () => {
    expect(smallestFreeNumber([1, 2, 3])).toBe(4);
  });
  it("1,2,3 заняты, 2 освободился — переиспользуется 2, не растёт до 4 (запрос пользователя 2026-07-17)", () => {
    expect(smallestFreeNumber([1, 3])).toBe(2);
  });
  it("порядок во входных данных не важен", () => {
    expect(smallestFreeNumber([5, 1, 3])).toBe(2);
  });
});

const START = new Date("2026-07-16T10:00:00.000Z");

function endAfter(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000);
}

describe("computeLaunchAmount — fixed", () => {
  it("фиксированная цена не зависит от фактической длительности", () => {
    const pricing = {
      pricingMode: "fixed" as const,
      priceSnapshot: 500,
      durationMinutesSnapshot: 30,
      roundingModeSnapshot: null,
      minAmountSnapshot: null,
    };
    expect(computeLaunchAmount(pricing, START, endAfter(10))).toBe(500);
    expect(computeLaunchAmount(pricing, START, endAfter(60 * 60))).toBe(500);
  });
});

describe("computeLaunchAmount — per_minute, округление (docs/spec/04-game-room.md, Шаг 6)", () => {
  const base = {
    pricingMode: "per_minute" as const,
    priceSnapshot: 10, // 10 за минуту
    durationMinutesSnapshot: null,
    minAmountSnapshot: null,
  };

  it("0:59 (меньше минуты) — up округляет до 1 минуты", () => {
    const pricing = { ...base, roundingModeSnapshot: "up" as const };
    expect(computeLaunchAmount(pricing, START, endAfter(59))).toBe(10);
  });
  it("0:59 — down округляет до 0 минут", () => {
    const pricing = { ...base, roundingModeSnapshot: "down" as const };
    expect(computeLaunchAmount(pricing, START, endAfter(59))).toBe(0);
  });
  it("0:59 — nearest округляет до 1 минуты (0.983 ближе к 1)", () => {
    const pricing = { ...base, roundingModeSnapshot: "nearest" as const };
    expect(computeLaunchAmount(pricing, START, endAfter(59))).toBe(10);
  });

  it("1:00 (ровно минута) — все режимы дают одинаково 1 минуту", () => {
    for (const mode of ["up", "down", "nearest"] as const) {
      const pricing = { ...base, roundingModeSnapshot: mode };
      expect(computeLaunchAmount(pricing, START, endAfter(60))).toBe(10);
    }
  });

  it("1:01 (чуть больше минуты) — up округляет до 2 минут", () => {
    const pricing = { ...base, roundingModeSnapshot: "up" as const };
    expect(computeLaunchAmount(pricing, START, endAfter(61))).toBe(20);
  });
  it("1:01 — down округляет до 1 минуты", () => {
    const pricing = { ...base, roundingModeSnapshot: "down" as const };
    expect(computeLaunchAmount(pricing, START, endAfter(61))).toBe(10);
  });
  it("1:01 — nearest округляет до 1 минуты (1.017 ближе к 1)", () => {
    const pricing = { ...base, roundingModeSnapshot: "nearest" as const };
    expect(computeLaunchAmount(pricing, START, endAfter(61))).toBe(10);
  });

  it("минималка поднимает сумму, если расчёт по времени меньше её", () => {
    const pricing = { ...base, roundingModeSnapshot: "down" as const, minAmountSnapshot: 50 };
    // 59 сек, down => 0 минут => 0 руб, но минималка 50 — итог 50.
    expect(computeLaunchAmount(pricing, START, endAfter(59))).toBe(50);
  });

  it("минималка не понижает сумму, если расчёт по времени уже больше её", () => {
    const pricing = { ...base, roundingModeSnapshot: "down" as const, minAmountSnapshot: 5 };
    expect(computeLaunchAmount(pricing, START, endAfter(180))).toBe(30); // 3 минуты × 10
  });
});

describe("aggregateOpenPrepaidLaunches — идущие браслеты «За вход» (docs/spec/04-game-room.md)", () => {
  const SINCE = new Date("2026-08-23T06:00:00.000Z");
  const UNTIL = new Date("2026-08-23T18:00:00.000Z");

  function fakeTx(launches: unknown[], legs: unknown[] = []) {
    const calls: { where?: unknown } = {};
    const tx = {
      launch: {
        findMany: async (args: { where: unknown }) => {
          calls.where = args.where;
          return launches;
        },
      },
      launchPaymentLeg: {
        findMany: async () => legs,
      },
    };
    return { tx: tx as unknown as Parameters<typeof aggregateOpenPrepaidLaunches>[3], calls };
  }

  it("сумма идёт из priceSnapshot — у идущего пуска amount ещё не заполнен", async () => {
    const { tx } = fakeTx([
      { id: "a", priceSnapshot: 300, paymentMethod: "cash" },
      { id: "b", priceSnapshot: 150, paymentMethod: "mobile" },
    ]);
    const agg = await aggregateOpenPrepaidLaunches("z1", SINCE, UNTIL, tx);
    expect(agg.count).toBe(2);
    expect(agg.totalAmount).toBe(450);
    expect(agg.cashAmount).toBe(300);
    expect(agg.mobileAmount).toBe(150);
    expect(agg.abonementAmount).toBe(0);
  });

  it("берёт только открытые «За вход» в окне с прошлой сдачи — «По факту» и закрытые сюда попасть не должны", async () => {
    const { tx, calls } = fakeTx([]);
    await aggregateOpenPrepaidLaunches("z1", SINCE, UNTIL, tx);
    expect(calls.where).toMatchObject({
      zoneId: "z1",
      voidedAt: null,
      isOpen: true,
      pricingMode: "fixed",
      startedAt: { gt: SINCE, lte: UNTIL },
    });
  });

  it("разбивка оплаты — доли берутся из LaunchPaymentLeg", async () => {
    const { tx } = fakeTx(
      [{ id: "a", priceSnapshot: 500, paymentMethod: "split" }],
      [
        { launchId: "a", method: "cash", amount: 200 },
        { launchId: "a", method: "abonement", amount: 300 },
      ]
    );
    const agg = await aggregateOpenPrepaidLaunches("z1", SINCE, UNTIL, tx);
    expect(agg.totalAmount).toBe(500);
    expect(agg.cashAmount).toBe(200);
    expect(agg.abonementAmount).toBe(300);
    // Баланс вычитается из выручки карточки — деньги учтены при пополнении
    expect(agg.totalAmount - agg.abonementAmount).toBe(200);
  });
});
