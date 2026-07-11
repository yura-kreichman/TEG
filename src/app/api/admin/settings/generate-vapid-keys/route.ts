import { NextResponse } from "next/server";
import webpush from "web-push";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { getSystemSettingsConfig, patchSystemSettingsConfig } from "@/lib/system-settings";

// Генерация новой VAPID-пары по явному действию Админа (кнопка в
// /admin/settings) — не автоматически при деплое и не самим агентом
// напрямую в .env (фидбек пользователя 2026-07-12: "сделай настройки для
// Админа для Push уведомлений"). Перезапись существующей пары аннулирует
// ВСЕ уже сохранённые PushSubscription — старые подписки браузеров были
// выданы под старый публичный ключ и станут недействительны, владельцам
// придётся заново включить push на каждом устройстве.
export async function POST() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const keys = webpush.generateVAPIDKeys();
  // patchSystemSettingsConfig мержит только верхнеуровневые ключи (см.
  // system-settings.ts) — subject нужно перенести вручную, иначе уже
  // введённый админом subject затёрся бы пустой строкой.
  const { vapid: currentVapid } = await getSystemSettingsConfig();
  await patchSystemSettingsConfig({
    vapid: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: currentVapid.subject },
  });

  return NextResponse.json({ ok: true, publicKey: keys.publicKey });
}
