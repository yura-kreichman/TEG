import { prisma } from "@/lib/prisma";

// Начальные (калибровочные) показания счётчиков — владелец задаёт их вручную
// для актива, который заводится в приложение уже не с нуля (реальный
// физический счётчик), см. AssetInitialReading в schema.prisma. Используется
// как fallback ТОЛЬКО пока для пары актив+тариф ещё нет ни одной настоящей
// AssetReading — везде, где обычно было "?? 0", должно быть
// "?? initialByKey.get(key) ?? 0".
export async function getInitialReadingsMap(assetIds: string[]): Promise<Map<string, number>> {
  if (assetIds.length === 0) return new Map();
  const rows = await prisma.assetInitialReading.findMany({
    where: { assetId: { in: assetIds } },
  });
  return new Map(rows.map((r) => [`${r.assetId}:${r.tariffId}`, r.reading]));
}
