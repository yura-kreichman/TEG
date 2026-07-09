// Next.js вызывает register() один раз при старте сервера, до обработки
// первого запроса (см. node_modules/next/dist/docs/.../instrumentation.md) —
// единственное штатное место для запуска долгоживущего фонового процесса
// вроде планировщика сводок, без отдельного cron-сервиса.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSummaryScheduler } = await import("@/lib/summary-scheduler");
    startSummaryScheduler();
  }
}
