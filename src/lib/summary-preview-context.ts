// Форма ответа GET /api/tenant/summary-settings/preview-context — общий тип
// для клиентских редакторов /settings/summaries/* (живой предпросмотр).
export interface SummaryPreviewContextByZone {
  pointName: string | null;
  zoneName: string | null;
  zoneEmoji: string | null;
  accountingMode: string | null;
  readingPairs: Array<{ assetName: string; tariffName: string }>;
  assetNames: string[];
  zoneNames: string[];
  // Оператор С РЕАЛЬНЫМ ДОСТУПОМ к этой конкретной зоне (allZonesAccess или
  // явно в allowedZones) — не общий на тенанта (реальный баг, найден
  // пользователем 2026-07-19: показывался оператор без доступа к зоне).
  operatorName: string | null;
  operatorColorTag: string | null;
}

export interface SummaryPreviewContext extends SummaryPreviewContextByZone {
  pointCount: number;
  timezone: string;
  operatorName: string | null;
  operatorColorTag: string | null;
  // Реальный контекст на каждый режим учёта — только для карусели
  // предпросмотра "Сводки по зоне" (см. api/tenant/summary-settings/
  // preview-context/route.ts).
  byMode: Record<"counters" | "launches" | "stays" | "cash_only" | "tickets", SummaryPreviewContextByZone>;
}
