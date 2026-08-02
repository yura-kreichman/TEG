import { describe, expect, it } from "vitest";
import { CLEANUP_MIN_AGE_DAYS, classifyTenant, type TenantActivityCounts } from "./tenant-cleanup";

// Классификатор решает, какие тенанты попадут в массовое удаление — ошибка
// здесь стоит безвозвратно удалённого клиента, поэтому защиты проверяются
// поимённо, а не одним общим случаем.

const EMPTY: TenantActivityCounts = {
  points: 0,
  operators: 0,
  submissions: 0,
  moneyOps: 0,
  instructions: 0,
  goods: 0,
  clients: 0,
  hasLanding: false,
  hasLogo: false,
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

const FREE_OLD = {
  createdAt: daysAgo(CLEANUP_MIN_AGE_DAYS + 5),
  unlimited: false,
  subscriptionStatus: "expired",
  fluentcartCustomerId: null,
  package: { fluentcartProductId: null },
};

describe("classifyTenant", () => {
  it("пустая Free-регистрация старше порога — подлежит удалению", () => {
    expect(classifyTenant(FREE_OLD, EMPTY)).toBe("deletable");
  });

  it("моложе порога — не трогаем, даже если пусто", () => {
    expect(classifyTenant({ ...FREE_OLD, createdAt: daysAgo(CLEANUP_MIN_AGE_DAYS - 1) }, EMPTY)).toBe("active");
  });

  it("ровно на пороге — уже кандидат", () => {
    expect(classifyTenant({ ...FREE_OLD, createdAt: daysAgo(CLEANUP_MIN_AGE_DAYS) }, EMPTY)).toBe("deletable");
  });

  describe("любой след работы переводит в «заброшен», а не в удаление", () => {
    const signals: [string, Partial<TenantActivityCounts>][] = [
      ["точка", { points: 1 }],
      ["сотрудник", { operators: 1 }],
      ["сдача итогов", { submissions: 1 }],
      ["денежная операция", { moneyOps: 1 }],
      ["инструктаж", { instructions: 1 }],
      ["товар", { goods: 1 }],
      ["клиент", { clients: 1 }],
      ["лендинг", { hasLanding: true }],
      ["логотип", { hasLogo: true }],
    ];

    for (const [label, patch] of signals) {
      it(label, () => {
        expect(classifyTenant(FREE_OLD, { ...EMPTY, ...patch })).toBe("abandoned");
      });
    }
  });

  describe("защиты — никогда не кандидат, даже пустой и старый", () => {
    it("сезонная пауза владельца", () => {
      expect(classifyTenant({ ...FREE_OLD, subscriptionStatus: "paused" }, EMPTY)).toBe("active");
    });

    it("ручной безлимит от Super Admin", () => {
      expect(classifyTenant({ ...FREE_OLD, unlimited: true }, EMPTY)).toBe("active");
    });

    it("привязан к клиенту FluentCart", () => {
      expect(classifyTenant({ ...FREE_OLD, fluentcartCustomerId: "cust_1" }, EMPTY)).toBe("active");
    });

    it("платный пакет", () => {
      expect(classifyTenant({ ...FREE_OLD, package: { fluentcartProductId: "12" } }, EMPTY)).toBe("active");
    });
  });
});
