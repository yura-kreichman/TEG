import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFluentCartPayload, syncTenantFromFluentCartEvent } from "@/lib/fluentcart-webhook";

// Приём вебхуков FluentCart (docs/spec/06-super-admin.md, п.5). Плагин
// FluentCart (см. FluentCart/fluent-cart-pro/.../WebhookConnect.php) шлёт
// то, что настроено в его собственном интеграционном фиде "Webhook":
// секрет и имя события — оба ТОЛЬКО через кастомные заголовки, которые
// заводятся вручную в админке FluentCart (Request Headers → "With Headers"),
// т.к. само тело запроса ("All Data") не содержит имя сработавшего события —
// это внутренний $hook плагина, наружу не сериализуется (см. комментарий в
// src/lib/fluentcart-webhook.ts). Отсюда практическая схема интеграции:
// один "Webhook"-фид на каждое нужное событие (Event Trigger в его
// настройках), с одинаковым заголовком секрета и СВОИМ заголовком события.
const SECRET_HEADER = "x-fluentcart-webhook-secret";
const EVENT_HEADER = "x-fluentcart-event";

export async function POST(request: Request) {
  const secret = process.env.FLUENTCART_WEBHOOK_SECRET;
  if (!secret || request.headers.get(SECRET_HEADER) !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const eventType = request.headers.get(EVENT_HEADER) ?? searchParams.get("event") ?? "unknown";

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseFluentCartPayload(payload, eventType);

  try {
    const result = await syncTenantFromFluentCartEvent(parsed);

    if (!result.matched) {
      // Ожидаемый случай (не серверная ошибка) — тенант ещё не привязан к
      // FluentCart ни по customer_id, ни по email. 200, чтобы FluentCart не
      // долбил ретраями; администратор находит и привязывает вручную по
      // WebhookEvent.status="failed" (доп. инструкция "связывание тенанта с
      // FluentCart", 2026-07-12).
      await prisma.webhookEvent.create({
        data: {
          provider: "fluentcart",
          eventType: parsed.eventType,
          payload: payload as object,
          status: "failed",
          error: result.reason,
        },
      });
      return NextResponse.json({ ok: true });
    }

    await prisma.webhookEvent.create({
      data: {
        provider: "fluentcart",
        eventType: parsed.eventType,
        payload: payload as object,
        status: "processed",
        error: result.skippedReason,
        tenantId: result.tenantId,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await prisma.webhookEvent.create({
      data: {
        provider: "fluentcart",
        eventType: parsed.eventType,
        payload: payload as object,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      },
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
