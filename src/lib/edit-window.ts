import { prisma } from "@/lib/prisma";
import { getZoneSubmissionEditability } from "@/lib/results-submission";

/**
 * Докуда назад владельцу вообще разрешено править деньги и рабочее время.
 *
 * Решение владельца 2026-09-03: «сегодня можно редактировать или удалять хоть
 * год назад — я не очень понимаю зачем это и куда вернутся деньги». Вопрос
 * правильный, и ответ был неприятный: все балансы считаются суммой по журналу,
 * поэтому правка расхода годичной давности МОЛЧА меняет сегодняшний остаток
 * кассы, «Разницу» давно закрытого дня и прибыль закрытого месяца. Физических
 * денег при этом не двигается.
 *
 * Замочек на «позапрошлых итогах», который владелец назвал образцом, устроен
 * структурно (getZoneSubmissionEditability): правь, пока от тебя ничего не
 * зависит дальше. Здесь та же мысль плюс срок — потому что у «живых» зон
 * (Прибывания/Пуски/Билеты) цепочки показаний нет вовсе и структурный замок
 * не сработал бы никогда.
 *
 * СЕМЬ ДНЕЙ — не с потолка, а с запасом втрое от наблюдаемой практики. По
 * боевой базе на 2026-09-03: денежные операции правили 5 раз и ВСЕ в тот же
 * день; смены — 18 раз, максимум на следующий день. Ни одной правки старше
 * суток за всю историю. То есть неограниченное окно не давало ничего, кроме
 * риска. Число выбрано владельцем.
 */
export const EDIT_WINDOW_DAYS = 7;

const WINDOW_MS = EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Почему заперто — чтобы интерфейс сказал человеку причину, а не просто «нельзя». */
export type EditLockReason = "tooOld" | "submissionClosed";

export interface EditWindow {
  editable: boolean;
  reason: EditLockReason | null;
}

const OPEN: EditWindow = { editable: true, reason: null };

function withinWindow(at: Date, now: Date): boolean {
  return now.getTime() - at.getTime() < WINDOW_MS;
}

/**
 * Смена сотрудника: только срок.
 *
 * Структурного замка тут быть не может. Напрашивалось «пока по сотруднику не
 * было выплаты после этой смены», но по боевой базе выплата есть после 61
 * смены из 101 — такое правило заперло бы больше половины истории и мешало бы
 * ровно тем правкам «на следующий день», которые люди реально делают.
 * OperatorBalanceCarryover как закрывающее событие тоже не годится: за всю
 * историю он использован ОДИН раз у одного сотрудника.
 *
 * Считаем от КОНЦА смены, а не от начала: у открытой смены конца ещё нет, и
 * она правится, сколько бы ни длилась.
 */
export function getShiftEditWindow(shift: { endAt: Date | null }, now: Date = new Date()): EditWindow {
  if (!shift.endAt) return OPEN;
  return withinWindow(shift.endAt, now) ? OPEN : { editable: false, reason: "tooOld" };
}

/**
 * Расход: срок И замочек сдачи, которая его забрала.
 *
 * Две причины, а не одна, потому что каждая закрывает свою дыру. Срок держит
 * «год назад». Замочек держит случай, когда расход уже вошёл в выручку сдачи
 * (submit-results пишет в журнал «сданный остаток + расходы этой зоны»), и
 * правка суммы задним числом рассогласовала бы ту сдачу — при этом выручку она
 * намеренно не трогает, а всплывает недостачей в «Разнице» закрытого дня.
 *
 * Расход, ещё не забранный сдачей (resultsSubmissionId пуст), правится
 * свободно в пределах срока — это сегодняшняя трата до вечернего пересчёта.
 */
export async function getExpenseEditWindow(
  op: { occurredAt: Date; zoneId: string | null; resultsSubmissionId: string | null },
  now: Date = new Date()
): Promise<EditWindow> {
  if (!withinWindow(op.occurredAt, now)) return { editable: false, reason: "tooOld" };
  if (!op.resultsSubmissionId || !op.zoneId) return OPEN;

  const zoneSubmission = await prisma.zoneSubmission.findFirst({
    where: { resultsSubmissionId: op.resultsSubmissionId, zoneId: op.zoneId },
    select: { id: true, zone: { select: { accountingMode: true } } },
  });
  // Сдачи уже нет (удалена владельцем) — держать расход запертым не за что.
  if (!zoneSubmission) return OPEN;

  const editability = await getZoneSubmissionEditability(zoneSubmission.id, zoneSubmission.zone.accountingMode);
  return editability.canEditCash ? OPEN : { editable: false, reason: "submissionClosed" };
}
