// Открытый список статусов задачи (тот же приём, что ZoneAccountingMode/
// MoneyOperation.type) — единственный источник правды и на бэке, и на фронте.
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}
