import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { INSTALL_TOKEN_TTL_MS, generateInstallToken } from "@/lib/operator-auth";
import { getRequestOrigin } from "@/lib/request-origin";

// Новая ссылка активации для УЖЕ существующего устройства (запрос владельца
// 2026-08-13, после реального случая: у «Рабочего» на КидсБурге пропала
// привязка).
//
// Зачем это понадобилось. Привязка устройства живёт в httpOnly-куке
// point_device. Сервер её не удаляет никогда — но браузер может: очистка
// данных сайта, очистка кук, переустановка PWA. Защититься от этого нельзя
// в принципе: navigator.storage.persist() спасает только от АВТОМАТИЧЕСКОЙ
// чистки при нехватке места и на куки не распространяется вовсе (MDN,
// StorageManager.persist: «Storage will not be cleared except by explicit
// user action»).
//
// Раз потерю не предотвратить, надо сделать дешёвым возврат. До этой правки
// он был неоправданно дорогим: activate-device одноразов и требует
// activated:false, а строка устройства остаётся activated:true навсегда —
// то есть починить существующее устройство было нельзя, приходилось заводить
// новое и копить мёртвые записи с теми же именами.
//
// Что делает роут: гасит текущую привязку (activated:false) и выдаёт свежий
// одноразовый токен. Устройство сохраняет имя, точку, роуминг, принтер и
// ширину чека — для владельца это «то же самое устройство», а не новое.
//
// ВАЖНО про activated:false. Пока по новой ссылке не прошли, устройство
// неактивно, и старая кука (если вдруг уцелела) перестанет работать сразу же
// — getActivatedDevice проверяет этот флаг. Это осознанно: перевыпуск ссылки
// означает «эта привязка больше не действует», и если планшет потерян, то же
// самое действие его и отключает.
export async function POST(request: Request, ctx: RouteContext<"/api/points/[id]/devices/[deviceId]/reissue">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: pointId, deviceId } = await ctx.params;
  const device = await prisma.pointDevice.findUnique({
    where: { id: deviceId },
    include: { point: true },
  });
  if (!device || device.pointId !== pointId || device.point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Устройство не найдено" }, { status: 404 });
  }

  const { token, tokenHash } = generateInstallToken();
  await prisma.pointDevice.update({
    where: { id: deviceId },
    data: {
      activated: false,
      activatedAt: null,
      installTokenHash: tokenHash,
      installTokenExpiresAt: new Date(Date.now() + INSTALL_TOKEN_TTL_MS),
    },
  });

  const installLink = `${getRequestOrigin(request)}/activate-device?token=${token}`;
  return NextResponse.json({ installLink });
}
