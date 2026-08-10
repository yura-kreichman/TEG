import { describe, expect, it } from "vitest";
import {
  FINAL_NOTICE_DAYS_BEFORE,
  FIRST_NOTICE_DAYS_BEFORE,
  PURGE_AFTER_DAYS,
  formatDeadline,
  isPurgeProtected,
  purgeDeadline,
  type PurgeCandidate,
} from "./tenant-lifecycle";

// Автоудаление сносит кабинет вместе с данными и файлами безвозвратно, поэтому
// защиты проверяются поимённо — тот же принцип, что у tenant-cleanup.test.ts.

const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

const FREE_ABANDONED: PurgeCandidate = {
  createdAt: daysAgo(PURGE_AFTER_DAYS + 1),
  unlimited: false,
  subscriptionStatus: "expired",
  fluentcartCustomerId: null,
  package: { fluentcartProductId: null },
};

describe("isPurgeProtected", () => {
  it("брошенный Free без следов оплаты — не защищён", () => {
    expect(isPurgeProtected(FREE_ABANDONED)).toBe(false);
  });

  it("ручной безлимит Super Admin'а защищает навсегда", () => {
    expect(isPurgeProtected({ ...FREE_ABANDONED, unlimited: true })).toBe(true);
  });

  it("сезонная пауза защищает — владелец закрылся на зиму, а не ушёл", () => {
    expect(isPurgeProtected({ ...FREE_ABANDONED, subscriptionStatus: "paused" })).toBe(true);
  });

  it("любой след покупки защищает, даже если сейчас Free", () => {
    expect(isPurgeProtected({ ...FREE_ABANDONED, fluentcartCustomerId: "42" })).toBe(true);
  });

  it("платный пакет защищает", () => {
    expect(isPurgeProtected({ ...FREE_ABANDONED, package: { fluentcartProductId: "12" } })).toBe(true);
  });
});

describe("purgeDeadline", () => {
  it("дедлайн — ровно PURGE_AFTER_DAYS от регистрации", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(purgeDeadline(createdAt).toISOString()).toBe(
      new Date(createdAt.getTime() + PURGE_AFTER_DAYS * DAY_MS).toISOString()
    );
  });

  it("оба предупреждения укладываются между регистрацией и дедлайном", () => {
    expect(FIRST_NOTICE_DAYS_BEFORE).toBeLessThan(PURGE_AFTER_DAYS);
    expect(FINAL_NOTICE_DAYS_BEFORE).toBeLessThan(FIRST_NOTICE_DAYS_BEFORE);
  });

  it("первое предупреждение приходит уже после конца бесплатного месяца", () => {
    // Иначе владелец получил бы письмо про удаление раньше, чем у него вообще
    // закончился бесплатный период — FREE_TRIAL_DAYS = 30 в api/auth/register.
    expect(PURGE_AFTER_DAYS - FIRST_NOTICE_DAYS_BEFORE).toBeGreaterThanOrEqual(30);
  });
});

describe("formatDeadline", () => {
  it("дата в письме — на языке получателя, не в ISO", () => {
    const deadline = new Date("2026-09-10T00:00:00.000Z");
    expect(formatDeadline(deadline, "ru")).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(formatDeadline(deadline, "en")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
