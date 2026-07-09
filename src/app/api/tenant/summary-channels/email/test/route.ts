import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { getTenantChannel } from "@/lib/telegram-bot";
import { isEmailConfigured, parseEmailAddresses, sendEmail } from "@/lib/summary-channels/email-channel";

export async function POST() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Почта не настроена" }, { status: 503 });
  }

  const channel = await getTenantChannel(owner.tenantId, "email");
  const addresses = parseEmailAddresses(channel?.emailAddresses);
  if (addresses.length === 0) {
    return NextResponse.json({ error: "Нет адресов" }, { status: 400 });
  }

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#F6F7F5;font-family:system-ui,sans-serif;color:#1B1F1D;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:24px;">
    <p style="font-size:14px;margin:0;">✅ RentOS подключён к этой почте</p>
  </div>
</body>
</html>`;

  const result = await sendEmail(addresses, "RentOS — тестовое письмо", html);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
