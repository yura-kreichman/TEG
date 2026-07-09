import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { getTenantChannel } from "@/lib/telegram-bot";
import { isEmailConfigured, parseEmailAddresses } from "@/lib/summary-channels/email-channel";

// У почты нет привязки/вебхука как у Telegram — тумблер + список адресов,
// сохраняются на один и тот же общий (pointId=null) канал тенанта.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const channel = await getTenantChannel(owner.tenantId, "email");

  // Пока нет ни канала, ни сохранённых адресов — подставляем email самого
  // владельца (его логин), как разумный дефолт по умолчанию: не сохраняем
  // это в БД молча, только подсказываем в форме, оно и произойдёт лишь если
  // владелец нажмёт «Сохранить».
  const emailAddresses = channel?.emailAddresses ?? owner.user.email;

  return NextResponse.json({
    smtpConfigured: isEmailConfigured(),
    enabled: channel?.enabled ?? false,
    emailAddresses,
  });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const body = await request.json();
  const data: { enabled?: boolean; emailAddresses?: string } = {};

  if (typeof body.enabled === "boolean") {
    data.enabled = body.enabled;
  }

  if (typeof body.emailAddresses === "string") {
    const addresses = parseEmailAddresses(body.emailAddresses);
    const invalid = addresses.find((a) => !EMAIL_PATTERN.test(a));
    if (invalid) {
      return NextResponse.json({ error: `Некорректный адрес: ${invalid}` }, { status: 400 });
    }
    data.emailAddresses = addresses.join(", ");
  }

  const channel = await getTenantChannel(owner.tenantId, "email");
  if (channel) {
    await prisma.tenantSummaryChannel.update({ where: { id: channel.id }, data });
  } else {
    await prisma.tenantSummaryChannel.create({
      data: { tenantId: owner.tenantId, channelType: "email", pointId: null, ...data },
    });
  }

  return NextResponse.json({ ok: true });
}
