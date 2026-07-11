import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { sendTestPushToUser } from "@/lib/push-notifications";

export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const result = await sendTestPushToUser(owner.user.id);
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
