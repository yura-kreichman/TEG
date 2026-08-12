/**
 * Право сотрудника вносить аванс/премию САМОМУ, при завершении смены
 * (docs/spec/05-work-time.md, запрос пользователя 2026-08-12).
 *
 * Отдельный файл, а не часть lib/work-time.ts, по одной практической
 * причине: work-time.ts импортирует lib/prisma, а эти же правила нужны
 * клиентским экранам ("use client") — и настройкам сотрудника у Владельца, и
 * PWA сотрудника, — чтобы UI и серверная проверка считались ОДНИМ кодом и не
 * могли разъехаться. Здесь только чистые функции, никаких зависимостей.
 */

export type SelfServicePayoutMode = "cash" | "forbidden" | "accrual";

export function isSelfServicePayoutMode(value: unknown): value is SelfServicePayoutMode {
  return value === "cash" || value === "forbidden" || value === "accrual";
}

export interface SelfServicePayoutRights {
  mode: SelfServicePayoutMode;
  /** Аванс наличными из кассы точки. */
  canAdvance: boolean;
  /** Премия наличными из кассы точки (bonus_payout). */
  canBonusCash: boolean;
  /** Премия начислением в баланс "к выдаче" (bonus_accrual), касса не трогается. */
  canBonusAccrual: boolean;
}

/**
 * Эффективное право: тенантный режим И персональный тумблер сотрудника.
 * Персональный только ЗАПРЕЩАЕТ — разрешить сверх режима тенанта он не может
 * (запрос пользователя 2026-08-12: "у сотрудника отдельно запретить несмотря
 * на разрешение всего тенанта").
 */
export function resolveSelfServicePayout(
  tenantMode: string | null | undefined,
  operatorAllowed: boolean
): SelfServicePayoutRights {
  const mode: SelfServicePayoutMode = isSelfServicePayoutMode(tenantMode) ? tenantMode : "cash";
  if (!operatorAllowed || mode === "forbidden") {
    return { mode, canAdvance: false, canBonusCash: false, canBonusAccrual: false };
  }
  if (mode === "accrual") {
    // Аванс недоступен намеренно, это не упущение: аванс ограничен балансом
    // "к выдаче", а начисленная премия этот баланс поднимает — вместе они
    // позволили бы сотруднику самому себе поднять лимит и забрать премию
    // наличными в два шага, обойдя весь смысл режима (разобрано с
    // пользователем при проектировании 2026-08-12).
    return { mode, canAdvance: false, canBonusCash: false, canBonusAccrual: true };
  }
  return { mode, canAdvance: true, canBonusCash: true, canBonusAccrual: false };
}
