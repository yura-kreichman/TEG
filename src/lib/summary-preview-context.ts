// Форма ответа GET /api/tenant/summary-settings/preview-context — общий тип
// для клиентских редакторов /settings/summaries/* (живой предпросмотр).
export interface SummaryPreviewContext {
  pointName: string | null;
  zoneName: string | null;
  zoneEmoji: string | null;
  accountingMode: string | null;
  readingPairs: Array<{ assetName: string; tariffName: string }>;
  zoneNames: string[];
  operatorName: string | null;
  operatorColorTag: string | null;
}
