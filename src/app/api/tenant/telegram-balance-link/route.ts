import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { requireOperator } from "@/lib/require-operator";
import { getClientBalanceDeepLink } from "@/lib/telegram-bot";
import { hasTelegramLink, normalizePhone } from "@/lib/abonement";

// Ссылка на бота для показа клиенту сразу после оплаты/пополнения (запрос
// пользователя 2026-07-23: "экран подтверждения оператора — как основной, чек
// — как бонус") — общий эндпоинт для Владельца И Сотрудника (оба топят
// баланс клиенту лично, докс: "оператор, прямо в момент оплаты"), в отличие
// от большинства /api/tenant/* эндпоинтов, которые только владельческие.
//
// ?phone= опционален — если передан, дополнительно проверяет, привязал ли
// ИМЕННО ЭТОТ клиент бота сам (запрос пользователя 2026-07-23: "если клиент
// уже есть в Telegram, ему печатать QR не нужно" — предлагать/печатать QR
// повторно тому, кто уже привязан, только шум).
export async function GET(request: Request) {
  const opCtx = await requireOperator();
  const owner = opCtx ? null : await requireOwner();
  if (!opCtx && !owner) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  const tenantId = opCtx ? opCtx.point.tenantId : owner!.tenantId;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  const link = tenant?.slug ? await getClientBalanceDeepLink(tenant.slug) : null;

  const phoneParam = new URL(request.url).searchParams.get("phone");
  const phone = phoneParam ? normalizePhone(phoneParam) : null;
  const hasTelegram = phone ? await hasTelegramLink(tenantId, phone) : false;

  return NextResponse.json({ link, hasTelegram });
}
