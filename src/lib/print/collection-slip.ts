import type { PrintDocumentData } from "@/lib/print/receipt-document";

/**
 * Слип инкассации — один сборщик на все три места, где он печатается
 * (запрос пользователя 2026-08-12): PWA сотрудника сразу после инкассации,
 * экран Владельца «Остатки и инкассации» сразу после неё же, и кнопка у
 * последней записи в Реестре инкассаций.
 *
 * До этого `buildCollectionReceiptData` была написана дважды — в
 * operator/page.tsx и money/zone-balances/page.tsx — и копии уже разошлись:
 * подпись брала разные источники, а поле точки — разные ключи словаря
 * (`operatorApp.pointLabel` против `money.pointLabel`). Любая правка формата
 * требовала не забыть про второй файл.
 *
 * Главное отличие от прежнего слипа: он показывал ОДНУ цифру — сколько
 * забрали. Но инкассация здесь не «взял пачку и записал число»: сумма
 * делится между зонами пропорционально остаткам, излишек снимается с касс
 * Абонементов и Товаров, а то, что никуда не поместилось, становится
 * «Авансом инкассации» (см. splitCollectionAmountDetailed в lib/zone-balance).
 * Без разбивки бумажка не отвечает на единственный вопрос, ради которого её
 * и берут в руки при передаче денег — из чего сложилась сумма.
 */
export interface CollectionSlipLine {
  /** Название зоны либо переведённая подпись пула (Абонементы/Товары/Аванс инкассации). */
  label: string;
  amount: number;
}

/**
 * То, что общая инкассация по точке отдаёт наружу — ровно те числа, по
 * которым она разложила сумму (см. /api/operator/collection/general и
 * owner-версию). У зонной и пуловой инкассации breakdown не приходит вовсе:
 * там делить нечего.
 */
export interface CollectionBreakdown {
  zones: { name: string; amount: number }[];
  abonement: number;
  goods: number;
  advance: number;
}

/** Переведённые подписи для строк, у которых нет собственного имени зоны. */
export interface CollectionPoolLabels {
  abonement: string;
  goods: string;
  advance: string;
}

/** Разбивка → строки слипа. Нулевые части выпадают, порядок фиксирован:
 *  сначала зоны, потом пулы, «Аванс инкассации» последним — он про остаток,
 *  которому не нашлось места, и на бумажке читается как примечание к итогу. */
export function breakdownToSlipLines(
  breakdown: CollectionBreakdown,
  labels: CollectionPoolLabels
): CollectionSlipLine[] {
  return [
    ...breakdown.zones.map((zone) => ({ label: zone.name, amount: zone.amount })),
    ...(breakdown.abonement > 0 ? [{ label: labels.abonement, amount: breakdown.abonement }] : []),
    ...(breakdown.goods > 0 ? [{ label: labels.goods, amount: breakdown.goods }] : []),
    ...(breakdown.advance > 0 ? [{ label: labels.advance, amount: breakdown.advance }] : []),
  ];
}

export interface CollectionSlipInput {
  title: string;
  /** Дата-время печати + кто провёл инкассацию. */
  subtitle: string;
  pointLabel: string;
  pointName: string;
  breakdownTitle: string;
  /** Разбивка. Пустая — у зонной инкассации, где вся сумма и есть одна зона. */
  lines: CollectionSlipLine[];
  totalLabel: string;
  total: string;
  /** Форматтер денег вызывающей стороны — здесь нет доступа ни к локали, ни к валюте. */
  formatMoney: (value: number) => string;
}

export function buildCollectionSlipData(input: CollectionSlipInput): PrintDocumentData {
  return {
    title: input.title,
    subtitle: input.subtitle,
    sections: [
      { lines: [{ label: input.pointLabel, value: input.pointName }] },
      // Секция разбивки не рендерится вовсе, когда делить нечего — у зонной
      // инкассации вся сумма относится к одной названной зоне, и повторять её
      // отдельной строкой над итогом значило бы показать одно число дважды.
      ...(input.lines.length > 0
        ? [
            {
              title: input.breakdownTitle,
              lines: input.lines.map((line) => ({
                label: line.label,
                value: input.formatMoney(line.amount),
                small: true,
              })),
            },
          ]
        : []),
    ],
    // stacked — та же причина, что у «Выписки по расчётам»: подпись и
    // шестизначная сумма не делят одну строку на 58мм, знак валюты уезжает
    // вниз и число ломается пополам.
    totalLine: { label: input.totalLabel, value: input.total, stacked: true },
  };
}
