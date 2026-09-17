import type { NextRequest, NextResponse } from "next/server";
import { readExpiringToken, sessionCookieOptions, signExpiringToken } from "@/lib/session-crypto";

// Привязка устройства бессрочна (решение владельца 2026-09-17: «время жизни
// привязанных устройств должно быть бесконечное»). Обе куки привязки —
// планшета точки (point_device) и личного телефона владельца (owner_device).
//
// Буквально бессрочную куку выдать нельзя: Chrome молча урезает срок любой
// куки до 400 дней, сколько бы ни было записано. До этой правки
// point_device жила год и в самом токене, и в куке — планшеты, привязанные
// 20.07.2026, разом разлогинились бы 20.07.2027 и ждали бы новую ссылку
// активации от владельца. owner_device записывалась на 10 лет, но браузер
// всё равно держал её 400 дней.
//
// Поэтому срок скользящий: каждая привязанная кука, пришедшая на сервер,
// перевыпускается на полные 400 дней (не чаще раза в сутки). Устройство,
// которым пользуются хоть раз в год с небольшим, не разлогинится никогда.
// Отвязка по-прежнему серверная: удалённый владельцем PointDevice не
// проходит getActivatedDevice, сколько бы кука ни продлевалась, а
// owner_device сама по себе ничего не открывает — вход требует пароль или ПИН.
export const POINT_DEVICE_COOKIE = "point_device";
export const OWNER_DEVICE_COOKIE = "owner_device";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // предел Chrome

const MAX_AGE_MS = DEVICE_COOKIE_MAX_AGE * 1000;
const RENEW_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Вызывается из proxy.ts на каждом GET/HEAD. Только читающие запросы: куки
 * удаляют и выдают POST-роуты (забыть устройство, вход, активация), и
 * продление в том же ответе могло бы вернуть удаляемую куку обратно.
 */
export function renewDeviceCookies(request: NextRequest, response: NextResponse) {
  for (const name of [POINT_DEVICE_COOKIE, OWNER_DEVICE_COOKIE]) {
    const token = request.cookies.get(name)?.value;
    if (!token) continue;
    const parsed = readExpiringToken(token);
    if (!parsed) continue;
    const remainingMs = parsed.expiresAtMs - Date.now();
    // Больше предела — токен старого формата (owner_device на 10 лет):
    // перевыпускаем сразу, иначе браузер уронил бы его через 400 дней.
    if (remainingMs > MAX_AGE_MS - RENEW_EVERY_MS && remainingMs <= MAX_AGE_MS) continue;
    response.cookies.set(
      name,
      signExpiringToken(parsed.id, Date.now() + MAX_AGE_MS),
      sessionCookieOptions(DEVICE_COOKIE_MAX_AGE)
    );
  }
}
