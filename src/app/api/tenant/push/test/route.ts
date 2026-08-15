import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { sendTestPushToUser } from "@/lib/push-notifications";
import { getDictionary, resolveLocale } from "@/lib/i18n";

export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  // Текст пробного уведомления — на языке тенанта, как и все остальные Push
  // (2026-08-16); раньше был захардкожен по-русски прямо в библиотеке.
  const ps = getDictionary(await resolveLocale()).pushSettings;
  const result = await sendTestPushToUser(owner.user.id, { title: ps.testPushTitle, body: ps.testPushBody });
  if (!result.ok) {
    const messages: Record<typeof result.error, string> = {
      notConfigured: "Push-уведомления не настроены на сервере (нет VAPID-ключей в /admin/settings)",
      noSubscriptions: "На этом аккаунте нет ни одной активной подписки — сначала включите push на устройстве",
      allFailed: "Не удалось отправить ни на одну подписку",
    };
    return NextResponse.json({ error: messages[result.error] }, { status: 400 });
  }

  return NextResponse.json({ ok: true, sent: result.sent });
}
