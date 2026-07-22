import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { sendChatMessage, sendPhotoMessage } from "@/lib/telegram-bot";

// Telegram ограничивает подпись к фото 1024 символами (жёстче, чем 4096 у
// обычного текста) — единый лимит поменьше для обоих случаев, чтобы с
// картинкой и без неё вести себя предсказуемо одинаково, не считать отдельно
// длину префикса "📣 <b>{имя тенанта}</b>\n\n" под каждый случай.
const MAX_MESSAGE_LENGTH = 900;
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
  const imageUrl: string | null = typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : null;
  if (!message) {
    return NextResponse.json({ error: "Введите текст сообщения" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Сообщение слишком длинное (максимум ${MAX_MESSAGE_LENGTH} символов)` }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { name: true } });
  const links = await prisma.clientTelegramLink.findMany({ where: { tenantId: owner.tenantId }, select: { chatId: true } });

  const text = `📣 <b>${tenant?.name ?? ""}</b>\n\n${message}`;
  // Ссылка на фото — относительный путь из /api/uploads (тот же формат, что
  // Tenant.logoUrl и т.п.), Telegram нужен полный URL, чтобы скачать файл
  // сам (см. комментарий у sendPhotoMessage в telegram-bot.ts).
  const absoluteImageUrl = imageUrl ? `${new URL(request.url).origin}${imageUrl}` : null;

  let sent = 0;
  for (const link of links) {
    const result = absoluteImageUrl
      ? await sendPhotoMessage(link.chatId, absoluteImageUrl, text)
      : await sendChatMessage(link.chatId, text);
    if (result.ok) sent++;
    await sleep(BETWEEN_SENDS_DELAY_MS);
  }

  return NextResponse.json({ sent, total: links.length });
}
