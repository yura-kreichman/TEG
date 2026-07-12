// Открытый список статусов задачи (тот же приём, что ZoneAccountingMode/
// MoneyOperation.type) — единственный источник правды и на бэке, и на фронте.
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

/** Shared Prisma `select` shape for Task, used by both the point-scoped and single-task routes. */
export const TASK_SELECT = {
  id: true,
  title: true,
  note: true,
  status: true,
  createdAt: true,
  assignedOperators: { select: { id: true, name: true, colorTag: true, avatarUrl: true, iconKey: true } },
  assignedUsers: { select: { id: true, email: true } },
} as const;
