import { prisma } from "@/lib/prisma";
import { dispatchCollectionAlert, pointNameIfMany } from "@/lib/summary-channels/dispatch";
import { COLLECTION_SUMMARY_DEFAULTS } from "@/lib/summary-settings";

/**
 * Объявить инкассацию: сообщение в Telegram/email + Push (запрос владельца
 * 2026-08-16). Одна точка вызова на все шесть роутов инкассации — зонную и
 * общую, оператора и владельца, — чтобы формат и тумблер не разъезжались.
 *
 * operationIds — все строки журнала, которые породила эта инкассация (общая
 * распадается на долю каждой зоны и пулы товаров/абонементов). Им проставляется
 * общий collectionAlertMessageId: по нему правка любой строки находит и
 * пересобирает сообщение целиком (см. lib/summary-channels/resync.ts).
 *
 * Ничего не бросает: инкассация к этому моменту уже проведена, и недоступный
 * чат не должен превращаться в ошибку операции.
 */
async function pointNameForCollection(tenantId: string, pointId: string | null): Promise<string | null> {
  if (!pointId) return null;
  const point = await prisma.point.findUnique({ where: { id: pointId }, select: { name: true } });
  return pointNameIfMany(tenantId, point?.name ?? null);
}

export async function announceCollection(params: {
  tenantId: string;
  operationIds: string[];
  // Точка инкассации — в сообщение попадёт отдельной строкой, но только
  // когда точек у тенанта несколько (правило владельца 2026-08-17).
  pointId?: string | null;
  occurredAt: Date;
  operatorName: string | null;
  operatorColorTag: string | null;
  amount: number;
  isAdvance: boolean;
  zones: { name: string; emoji: string | null; amount: number }[];
  goodsAmount: number;
  abonementAmount: number;
}): Promise<void> {
  try {
    const settings = await prisma.collectionSummarySettings.findUnique({ where: { tenantId: params.tenantId } });
    if (!(settings?.enabled ?? COLLECTION_SUMMARY_DEFAULTS.enabled)) return;

    const results = await dispatchCollectionAlert(params.tenantId, {
      occurredAt: params.occurredAt,
      pointName: await pointNameForCollection(params.tenantId, params.pointId ?? null),
      operatorName: params.operatorName,
      operatorColorTag: params.operatorColorTag,
      amount: params.amount,
      isAdvance: params.isAdvance,
      zones: params.zones,
      goodsAmount: params.goodsAmount,
      abonementAmount: params.abonementAmount,
    });

    const messageId = results.find((r) => r.channelType === "telegram" && r.ok && r.externalMessageId)?.externalMessageId;
    if (!messageId || params.operationIds.length === 0) return;
    await prisma.moneyOperation.updateMany({
      where: { id: { in: params.operationIds } },
      data: { collectionAlertMessageId: messageId },
    });
  } catch (err) {
    console.error("collection alert failed", err);
  }
}
