import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { sendChatMessage } from "@/lib/telegram-bot";

const MAX_MESSAGE_LENGTH = 1000;
// Пауза между отправками (запрос пользователя 2026-07-23: "Владелец может
// слать промо клиентам, у кого подключён Telegram") — тот же приём и то же
// значение, что уже используется в summary-scheduler.ts между точками одного
// тика: разные чаты, но лимит Telegram общий на бота (~1 сообщение/сек
// надёжно), при рассылке на десятки клиентов подряд имеет смысл не рисковать.
const BETWEEN_SENDS_DELAY_MS = 200;
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Рассылка Владельца своим клиентам, подключившим Telegram-бота (запрос
// пользователя 2026-07-23) — без отдельного тумблера-разрешения в настройках
// ("в глобальных настройках не нужна такая опция" — явное решение
// пользователя), но с меткой "📣" в самом тексте, чтобы не путать с
// транзакционными уведомлениями бота (баланс/заказы).
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const message: string = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Введите текст сообщения" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Сообщение слишком длинное (максимум ${MAX_MESSAGE_LENGTH} символов)` }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { name: true } });
  const links = await prisma.clientTelegramLink.findMany({ where: { tenantId: owner.tenantId }, select: { chatId: true } });

  const text = `📣 <b>${tenant?.name ?? ""}</b>\n\n${message}`;
  let sent = 0;
  for (const link of links) {
    const result = await sendChatMessage(link.chatId, text);
    if (result.ok) sent++;
    await sleep(BETWEEN_SENDS_DELAY_MS);
  }

  return NextResponse.json({ sent, total: links.length });
}
