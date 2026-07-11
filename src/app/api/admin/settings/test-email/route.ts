import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { isEmailConfigured, sendEmail } from "@/lib/summary-channels/email-channel";

// Тестовое письмо с только что сохранёнными платформенными SMTP-настройками
// (docs/spec/06-super-admin.md, /admin/settings) — адрес получателя вводит
// сам администратор в форме, сохранённого адреса для этого ещё нет.
export async function POST(request: Request) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { to } = await request.json();
  if (typeof to !== "string" || !to.trim()) {
    return NextResponse.json({ error: "Укажите email получателя" }, { status: 400 });
  }

  if (!(await isEmailConfigured())) {
    return NextResponse.json({ error: "SMTP не настроен" }, { status: 503 });
  }

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#F6F7F5;font-family:system-ui,sans-serif;color:#1B1F1D;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:24px;">
    <p style="font-size:14px;margin:0;">✅ SMTP платформы RentOS настроен и работает.</p>
  </div>
</body>
</html>`;

  const result = await sendEmail([to.trim()], "RentOS — тестовое письмо (Admin)", html);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
