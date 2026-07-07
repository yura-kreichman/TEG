import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-crypto";

/**
 * Sends a message to the tenant's configured Telegram chat. Silently no-ops if
 * Telegram isn't configured, and swallows delivery failures (network issues,
 * revoked token, etc.) so a Telegram outage never blocks a results submission.
 */
export async function sendTenantTelegramMessage(tenantId: string, text: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { telegramBotToken: true, telegramChatId: true },
  });
  if (!tenant?.telegramBotToken || !tenant.telegramChatId) return;

  try {
    const token = decryptSecret(tenant.telegramBotToken);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tenant.telegramChatId, text }),
    });
    if (!res.ok) {
      console.error("Telegram send rejected", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Telegram send failed", err);
  }
}
