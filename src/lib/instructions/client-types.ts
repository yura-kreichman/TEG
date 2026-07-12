// Формы ответов API модуля Инструктажи (docs/spec/07-instructions.md),
// общие между страницей и её bottom sheet'ами — держим в одном месте, чтобы
// не разъезжались при правках полей.
export interface InstructionListItem {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
  currentVersionNumber: number;
  recordsCount: number;
  honestyCheck: boolean;
  createdAt: string;
}

export interface AcknowledgmentRecordItem {
  id: string;
  instructionId: string;
  instructionTitle: string;
  lastName: string;
  firstName: string;
  phone: string;
  birthDate: string;
  readingSeconds: number;
  ip: string;
  deviceLabel: string | null;
  browserLabel: string | null;
  versionNumber: number;
  isStale: boolean;
  isSuspiciouslyFast: boolean;
  createdAt: string;
}
