import { describe, expect, it } from "vitest";
import {
  FINAL_NOTICE_DAYS_BEFORE,
  FIRST_NOTICE_DAYS_BEFORE,
  PURGE_AFTER_DAYS,
  formatDeadline,
  isPurgeProtected,
  purgeDeadline,
  purgeScheduleFor,
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

// Строка «Удаление кабинета: дата · через N дн.» в админ-модуле берётся
// отсюда. Ошибка тут — это обещанная владельцу дата, которая не наступит,
// поэтому защиты проверяются тем же поимённым набором, что и выше.
describe("purgeScheduleFor", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const freshFree: PurgeCandidate = {
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    unlimited: false,
    subscriptionStatus: "active",
    fluentcartCustomerId: null,
    package: { fluentcartProductId: null },
  };

  it("Free без следов оплаты — дата и остаток дней", () => {
    const schedule = purgeScheduleFor(freshFree, now);
    expect(schedule?.at.toISOString()).toBe(purgeDeadline(freshFree.createdAt).toISOString());
    expect(schedule?.daysLeft).toBe(PURGE_AFTER_DAYS);
  });

  it("защищённым кабинетам даты нет вовсе — иначе админка обещала бы неправду", () => {
    expect(purgeScheduleFor({ ...freshFree, unlimited: true }, now)).toBeNull();
    expect(purgeScheduleFor({ ...freshFree, subscriptionStatus: "paused" }, now)).toBeNull();
    expect(purgeScheduleFor({ ...freshFree, fluentcartCustomerId: "42" }, now)).toBeNull();
    expect(purgeScheduleFor({ ...freshFree, package: { fluentcartProductId: "12" } }, now)).toBeNull();
  });

  it("остаток округляется вверх: четыре часа до дедлайна — это «через 1 дн.», не «через 0»", () => {
    const almostDue = { ...freshFree, createdAt: new Date(now.getTime() - (PURGE_AFTER_DAYS * DAY_MS - 4 * 3_600_000)) };
    expect(purgeScheduleFor(almostDue, now)?.daysLeft).toBe(1);
  });

  it("просроченный кабинет не уходит в минус", () => {
    expect(purgeScheduleFor({ ...freshFree, createdAt: daysAgo(PURGE_AFTER_DAYS + 5) })?.daysLeft).toBe(0);
  });
});

describe("formatDeadline", () => {
  it("дата в письме — на языке получателя, не в ISO", () => {
    const deadline = new Date("2026-09-10T00:00:00.000Z");
    expect(formatDeadline(deadline, "ru")).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(formatDeadline(deadline, "en")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
