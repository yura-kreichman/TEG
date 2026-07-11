import { prisma } from "@/lib/prisma";

export type TimeTrackingMode = "manual" | "auto";

export function isTimeTrackingMode(value: unknown): value is TimeTrackingMode {
  return value === "manual" || value === "auto";
}

const SHIFT_TOO_LONG_MS = 16 * 60 * 60 * 1000;

// Открытая смена дольше 16 часов (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА
// ВРЕМЕНИ") — оператору при входе плашка "обратись к владельцу", владельцу в
// табеле подсветка "требует правки". Автозакрытия нет, это только флаг.
export function isShiftTooLong(startAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startAt.getTime() > SHIFT_TOO_LONG_MS;
}

// Мягкое напоминание (docs/spec/05-work-time.md, "СВЯЗЬ СО СДАЧЕЙ ИТОГОВ") —
// по доступным оператору зонам за день `at` ещё не было сдачи итогов. Общее
// для ручного ввода смены и check-in/check-out — раньше было продублировано.
export async function hasNoResultsToday(
  point: { id: string },
  operator: { id: string; allZonesAccess: boolean },
  at: Date
): Promise<boolean> {
  const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const zoneWhere = operator.allZonesAccess
    ? { pointId: point.id }
    : { pointId: point.id, operatorsWithAccess: { some: { id: operator.id } } };
  const accessibleZoneIds = (await prisma.zone.findMany({ where: zoneWhere, select: { id: true } })).map((z) => z.id);
  if (accessibleZoneIds.length === 0) return false;

  const todaySubmission = await prisma.resultsSubmission.findFirst({
    where: {
      pointId: point.id,
      submittedAt: { gte: dayStart, lt: dayEnd },
      zoneSubmissions: { some: { zoneId: { in: accessibleZoneIds } } },
    },
    select: { id: true },
  });
  return !todaySubmission;
}

// Открытая смена (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА ВРЕМЕНИ") — startAt задан, endAt ещё
// null (isOpen=true), между check-in и check-out. На оператора не больше
// одной сразу (см. частичный уникальный индекс Shift_operatorId_open_unique
// в миграции). Фильтруем по isOpen, а не endAt — см. комментарий у
// Shift.isOpen в schema.prisma.
export async function getOpenShift(operatorId: string) {
  return prisma.shift.findFirst({ where: { operatorId, isOpen: true } });
}

// Часовая ставка, действующая на указанную дату — последняя запись истории
// ставок оператора с effectiveFrom <= date (docs/spec/05-work-time.md,
// "СТАВКА"). Смена ставки не пересчитывает прошлые смены: каждая смена
// всегда ищет СВОЮ дату в этой истории при чтении, ничего не денормализуется.
export async function getRateForDate(operatorId: string, date: Date): Promise<number> {
  const rate = await prisma.operatorRate.findFirst({
    where: { operatorId, effectiveFrom: { lte: date } },
    // Сортировка по effectiveFrom не даёт детерминированный порядок при
    // равных датах (обычное дело — несколько правок в один день без явной
    // effectiveFrom) — createdAt как второй ключ гарантирует, что побеждает
    // именно последняя внесённая запись, а не случайная среди равных.
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  return rate ? Number(rate.rate) : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Начислено за смену = минуты × ставка / 60, округление до копеек
// (docs/spec/05-work-time.md, "СТАВКА"). Дата/минуты — только endAt − startAt
// как есть; смена через полночь штатно даёт endAt на следующие сутки, ничего
// специально не корректируем.
export function calcShiftAccrual(startAt: Date, endAt: Date, rate: number): { minutes: number; accrued: number } {
  const minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  return { minutes, accrued: round2((minutes * rate) / 60) };
}

export type ShiftWarningCode = "too_long";

// Мягкая валидация (docs/spec/05-work-time.md, "ВАЛИДАЦИЯ") — в стиле модуля
// Счётчики: предупреждение, не ошибка, отправка всё равно возможна.
// Пересечение смен того же оператора — НЕ сюда, см. hasOverlappingShift ниже:
// один человек физически не может быть на двух сменах одновременно, это
// жёсткая блокировка, а не предупреждение (уточнение поверх спеки, 2026-07-08).
export function validateShift(startAt: Date, endAt: Date): ShiftWarningCode[] {
  const warnings: ShiftWarningCode[] = [];
  const minutes = (endAt.getTime() - startAt.getTime()) / 60000;
  if (minutes > 16 * 60) warnings.push("too_long");
  return warnings;
}

// Жёсткая проверка пересечения смен одного оператора — физически невозможно,
// поэтому блокирует создание/правку (409), в отличие от остальных мягких
// предупреждений выше.
export async function hasOverlappingShift(
  operatorId: string,
  startAt: Date,
  endAt: Date,
  excludeShiftId?: string
): Promise<boolean> {
  const overlapping = await prisma.shift.findFirst({
    where: {
      operatorId,
      ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}),
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  return !!overlapping;
}

export interface OperatorBalance {
  toPayOut: number; // "К выдаче"
  earnedInPeriod: number; // "заработано за период" — по ставке + премии
  rateEarnedInPeriod: number; // начислено по ставке за период (без премий)
  advancesInPeriod: number;
  bonusesInPeriod: number;
}

// Баланс оператора (docs/spec/05-work-time.md, "БАЛАНС") — скользящий, без
// периодов/обнуления:
// К выдаче = Σ(начислено по ставке, ВЕСЬ журнал) − Σ(авансы, ВЕСЬ журнал) + перенос.
// Заработано за период — только информационный показатель для period, на
// "к выдаче" не влияет; премия туда входит, в "к выдаче" — никогда (уже выдана).
export async function calcOperatorBalance(
  operatorId: string,
  period?: { from: Date; to: Date }
): Promise<OperatorBalance> {
  const [shifts, rates, moneyOps, carryovers] = await Promise.all([
    // isOpen: открытая смена (docs/spec/05-work-time.md, "АВТО"), ещё не
    // начислена, не в этом расчёте: попадёт в баланс при check-out.
    prisma.shift.findMany({ where: { operatorId, isOpen: false } }),
    prisma.operatorRate.findMany({ where: { operatorId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] }),
    prisma.moneyOperation.findMany({
      where: { beneficiaryOperatorId: operatorId, type: { in: ["advance", "bonus_payout"] } },
    }),
    prisma.operatorBalanceCarryover.findMany({ where: { operatorId } }),
  ]);

  function rateForDate(date: Date): number {
    const rate = rates.find((r) => r.effectiveFrom <= date);
    return rate ? Number(rate.rate) : 0;
  }

  let totalAccrued = 0;
  let periodAccrued = 0;
  for (const shift of shifts) {
    const { accrued } = calcShiftAccrual(shift.startAt, shift.endAt!, rateForDate(shift.startAt));
    totalAccrued += accrued;
    if (period && shift.startAt >= period.from && shift.startAt < period.to) periodAccrued += accrued;
  }

  let totalAdvances = 0;
  let periodAdvances = 0;
  let periodBonuses = 0;
  for (const op of moneyOps) {
    // advance/bonus_payout хранятся отрицательными (уменьшают кассу точки,
    // как collection) — здесь нужна величина, знак сама операция уже несёт.
    const amount = Math.abs(Number(op.amount));
    const inPeriod = period ? op.occurredAt >= period.from && op.occurredAt < period.to : false;
    if (op.type === "advance") {
      totalAdvances += amount;
      if (inPeriod) periodAdvances += amount;
    } else if (op.type === "bonus_payout" && inPeriod) {
      periodBonuses += amount;
    }
  }

  const totalCarryover = carryovers.reduce((sum, c) => sum + Number(c.amount), 0);

  return {
    toPayOut: round2(totalAccrued - totalAdvances + totalCarryover),
    earnedInPeriod: round2(periodAccrued + periodBonuses),
    rateEarnedInPeriod: round2(periodAccrued),
    advancesInPeriod: round2(periodAdvances),
    bonusesInPeriod: round2(periodBonuses),
  };
}

export interface ShiftDetail {
  id: string;
  startAt: Date;
  endAt: Date | null; // null только для open:true (открытая смена)
  minutes: number | null;
  rate: number | null;
  accrued: number | null;
  advanceAmount: number;
  bonusAmount: number;
  open: boolean;
  // Открытая смена дольше 16 часов (docs/spec/05-work-time.md) — подсветка
  // "требует правки" в табеле владельца. Всегда false для open:false.
  requiresEdit: boolean;
}

// Табель (список смен с начислением и связанными авансом/премией) — общий
// для PWA оператора (свои смены, includeOpen всегда false — открытая смена
// не показывается оператору до check-out) и карточки оператора в кабинете
// владельца (includeOpen:true — владелец должен видеть и суметь поправить
// зависшую открытую смену). Начисление для открытой смены не считается
// (endAt/minutes/rate/accrued = null) — по спеке расчёт только после закрытия.
// Открытая смена показывается вне периода-фильтра: это не историческая
// запись, а текущее состояние, требующее внимания.
export async function listShiftDetails(
  operatorId: string,
  period?: { from: Date; to: Date },
  options?: { includeOpen?: boolean }
): Promise<ShiftDetail[]> {
  const [closedShifts, openShift] = await Promise.all([
    prisma.shift.findMany({
      where: {
        operatorId,
        isOpen: false,
        ...(period ? { startAt: { gte: period.from, lt: period.to } } : {}),
      },
      orderBy: { startAt: "desc" },
    }),
    options?.includeOpen ? getOpenShift(operatorId) : Promise.resolve(null),
  ]);
  if (closedShifts.length === 0 && !openShift) return [];

  const rates = await prisma.operatorRate.findMany({
    where: { operatorId },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  function rateForDate(date: Date): number {
    const rate = rates.find((r) => r.effectiveFrom <= date);
    return rate ? Number(rate.rate) : 0;
  }

  const moneyOps = closedShifts.length
    ? await prisma.moneyOperation.findMany({
        where: { shiftId: { in: closedShifts.map((s) => s.id) }, type: { in: ["advance", "bonus_payout"] } },
      })
    : [];
  const moneyByShift = new Map<string, { advance: number; bonus: number }>();
  for (const op of moneyOps) {
    const entry = moneyByShift.get(op.shiftId!) ?? { advance: 0, bonus: 0 };
    const amount = Math.abs(Number(op.amount));
    if (op.type === "advance") entry.advance += amount;
    else entry.bonus += amount;
    moneyByShift.set(op.shiftId!, entry);
  }

  const closedRows: ShiftDetail[] = closedShifts.map((shift) => {
    const rate = rateForDate(shift.startAt);
    const { minutes, accrued } = calcShiftAccrual(shift.startAt, shift.endAt!, rate);
    const money = moneyByShift.get(shift.id) ?? { advance: 0, bonus: 0 };
    return {
      id: shift.id,
      startAt: shift.startAt,
      endAt: shift.endAt!,
      minutes,
      rate,
      accrued,
      advanceAmount: money.advance,
      bonusAmount: money.bonus,
      open: false,
      requiresEdit: false,
    };
  });

  if (!openShift) return closedRows;

  const openRow: ShiftDetail = {
    id: openShift.id,
    startAt: openShift.startAt,
    endAt: null,
    minutes: null,
    rate: null,
    accrued: null,
    advanceAmount: 0,
    bonusAmount: 0,
    open: true,
    requiresEdit: isShiftTooLong(openShift.startAt),
  };
  return [openRow, ...closedRows];
}

export interface StandaloneMoneyOp {
  id: string;
  type: "advance" | "bonus_payout";
  amount: number;
  occurredAt: Date;
  comment: string | null;
}

// Авансы/премии, добавленные владельцем вручную из карточки (не привязаны к
// смене — shiftId=null). Без этого списка они нигде не видны, кроме как через
// свой эффект на итоговый баланс (docs/spec/05-work-time.md, "РОЛИ И
// ВИДИМОСТЬ" — оператор должен видеть свои премии/авансы, не только смены).
export async function listStandaloneMoneyOps(
  operatorId: string,
  period?: { from: Date; to: Date }
): Promise<StandaloneMoneyOp[]> {
  const ops = await prisma.moneyOperation.findMany({
    where: {
      beneficiaryOperatorId: operatorId,
      shiftId: null,
      type: { in: ["advance", "bonus_payout"] },
      ...(period ? { occurredAt: { gte: period.from, lt: period.to } } : {}),
    },
    orderBy: { occurredAt: "desc" },
  });
  return ops.map((op) => ({
    id: op.id,
    type: op.type as "advance" | "bonus_payout",
    amount: Math.abs(Number(op.amount)),
    occurredAt: op.occurredAt,
    comment: op.comment,
  }));
}
