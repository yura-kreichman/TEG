// Разбивка "общей" инкассации на целые суммы по зонам (запрос пользователя
// 2026-07-15) — общий для оператора (/api/operator/collection/general) и
// владельца (/api/points/[id]/collection/general): к моменту сбора наличные
// всех зон точки часто уже физически лежат одной стопкой, разложить обратно
// по зонам невозможно — вводится один общий итог, а зонные суммы
// рассчитываются пропорционально текущему остатку каждой зоны.
//
// Округление — метод наибольшего остатка в "круглых" юнитах по NICE_UNIT
// (цены на прокат почти всегда кратны 5/10, дробные/произвольные суммы по
// зонам выглядят "некрасиво"): целая часть пропорциональной доли в юнитах +
// оставшиеся юниты по одному зонам с наибольшим дробным остатком, пока сумма
// не сойдётся ровно с введённым итогом. Если сама сумма не кратна NICE_UNIT —
// некруглый хвост (< NICE_UNIT) целиком достаётся зоне с наибольшей итоговой
// суммой, чтобы некруглой вышла только одна зона, а не все сразу. Если
// остатки всех зон <= 0 (делить не от чего) — делим поровну.
const NICE_UNIT = 5;

export function distributeCollectionWhole(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const positive = weights.map((w) => Math.max(0, w));
  const sumPositive = positive.reduce((a, b) => a + b, 0);
  const effective = sumPositive > 0 ? positive : weights.map(() => 1);
  const sumEffective = effective.reduce((a, b) => a + b, 0);

  const niceTotal = Math.floor(total / NICE_UNIT) * NICE_UNIT;
  // До копеек (100, не 1) — реальный баг, найден аудитом 2026-07-25: раньше
  // Math.round(total - niceTotal) округлял хвост до целого рубля, из-за чего
  // дробная часть входной суммы (например, 0.45 ₽ у 123.45) молча пропадала —
  // не попадала ни в одну зону, ни в "Аванс инкассации", просто исчезала из
  // системы. Раньше все вызывающие места передавали только целые суммы,
  // поэтому баг не проявлялся, но settleOutstandingCollectionAdvance
  // (округляет до копеек, не до рубля) и chargeSelfServiceAdvanceToZones
  // (сумма аванса/премии сотрудника, никогда не округляется до целого) — оба
  // в lib/zone-balance.ts — реально передают сюда дробные суммы.
  const oddLeftover = Math.round((total - niceTotal) * 100) / 100;
  const unitsTotal = niceTotal / NICE_UNIT;

  const raw = effective.map((w) => (w / sumEffective) * unitsTotal);
  const floors = raw.map((r) => Math.floor(r));
  let remainingUnits = Math.round(unitsTotal - floors.reduce((a, b) => a + b, 0));

  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac);

  const units = [...floors];
  for (let k = 0; k < byRemainder.length && remainingUnits > 0; k++) {
    units[byRemainder[k].i] += 1;
    remainingUnits -= 1;
  }

  const result = units.map((u) => u * NICE_UNIT);
  if (oddLeftover > 0) {
    const biggestIdx = result.reduce((best, v, i) => (v > result[best] ? i : best), 0);
    result[biggestIdx] += oddLeftover;
  }
  return result;
}
