import type { NextRequest, NextResponse } from "next/server";
import {
  readExpiringToken,
  sessionCookieOptions,
  signExpiringToken,
  signSessionToken,
  verifySessionDetails,
} from "@/lib/session-crypto";

// Бессрочные куки: привязка устройств (решение владельца 2026-09-17: «время
// жизни привязанных устройств должно быть бесконечное») и сессии — владельца
// и сотрудника на активированном устройстве (решение 2026-09-24: «Сессия
// Владельца должна быть бесконечная. Как и сотрудника на активированном
// устройстве»).
//
// До 2026-09-24 сессия владельца жила ровно 7 дней от входа и работой в
// кабинете не продлевалась: телефон владельца КидсБурга вошёл 17.09 в 16:04,
// а 24.09 в 16:04 молча вылетел на экран ПИН-кода посреди обычной недели.
// Сессия сотрудника жила 12 часов.
//
// Буквально бессрочную куку выдать нельзя: Chrome молча урезает срок любой
// куки до 400 дней, сколько бы ни было записано. Поэтому срок скользящий:
// кука, пришедшая с открытием страницы, перевыпускается на полные 400 дней
// (не чаще раза в сутки). Кто открывает приложение хоть раз в год
// с небольшим, не разлогинится никогда.
//
// Закрыть доступ по-прежнему можно с сервера, продление этому не мешает:
// удалённое устройство точки не проходит getActivatedDevice, выключенный
// сотрудник или точка — requireOperator, смена пароля отзывает все сессии
// владельца (lib/session-revocation.ts). owner_device сама по себе ничего
// не открывает — вход по ней требует пароль или ПИН. Сменить сотрудника на
// планшете — кнопкой «Сменить сотрудника»: сам через 12 часов планшет ПИН
// больше не спрашивает.
export const POINT_DEVICE_COOKIE = "point_device";
export const OWNER_DEVICE_COOKIE = "owner_device";
export const OPERATOR_SESSION_COOKIE = "operator_session";
export const SESSION_COOKIE = "session";
export const ENDLESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // предел Chrome

const MAX_AGE_MS = ENDLESS_COOKIE_MAX_AGE * 1000;
const RENEW_EVERY_MS = 24 * 60 * 60 * 1000;

// Сессия имперсонации (Super Admin в кабинете владельца, lib/auth.ts) лежит в
// той же куке session, но живёт 2 часа от входа админа и продлеваться не
// должна. Отличаем по самому токену: у владельца срок от выдачи — неделя
// (выданные до 2026-09-24) или 400 дней.
const SHORT_SESSION_MS = RENEW_EVERY_MS;

function isRenewalDue(expiresAtMs: number) {
  const remainingMs = expiresAtMs - Date.now();
  // Больше предела — токен старого формата (owner_device на 10 лет):
  // перевыпускаем сразу, иначе браузер уронил бы его через 400 дней.
  return !(remainingMs > MAX_AGE_MS - RENEW_EVERY_MS && remainingMs <= MAX_AGE_MS);
}

/**
 * Вызывается из proxy.ts на каждом ответе. Продлевает только при открытии
 * страницы, не на фоновых запросах: куки удаляют POST-роуты (выход, «Сменить
 * сотрудника», забыть устройство), а опрос вроде /api/auth/operator/me,
 * ушедший за миг до выхода, вернул бы удалённую куку ответом — и на планшете
 * остался бы прежний сотрудник. Выход страница делает сама, одновременно с
 * её же открытием он не случается. Браузер без Sec-Fetch-Mode (Safari до
 * 16.4) продлевает на любом GET — иначе он не продлевал бы вовсе.
 */
export function renewEndlessCookies(request: NextRequest, response: NextResponse) {
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const fetchMode = request.headers.get("sec-fetch-mode");
  if (fetchMode && fetchMode !== "navigate") return;

  for (const name of [POINT_DEVICE_COOKIE, OWNER_DEVICE_COOKIE, OPERATOR_SESSION_COOKIE]) {
    const token = request.cookies.get(name)?.value;
    const parsed = token ? readExpiringToken(token) : null;
    if (!parsed || !isRenewalDue(parsed.expiresAtMs)) continue;
    response.cookies.set(
      name,
      signExpiringToken(parsed.id, Date.now() + MAX_AGE_MS),
      sessionCookieOptions(ENDLESS_COOKIE_MAX_AGE)
    );
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const session = sessionToken ? verifySessionDetails(sessionToken) : null;
  if (!session || session.expiresAtMs - session.issuedAtMs <= SHORT_SESSION_MS) return;
  if (!isRenewalDue(session.expiresAtMs)) return;
  // Время выдачи — прежнее: по нему смена пароля отзывает сессии. Свежее
  // время выдачи вернуло бы к жизни уже отозванную сессию — proxy в базу не
  // ходит и об отзыве не знает.
  response.cookies.set(
    SESSION_COOKIE,
    signSessionToken(session.userId, session.issuedAtMs, Date.now() + MAX_AGE_MS),
    sessionCookieOptions(ENDLESS_COOKIE_MAX_AGE)
  );
}
