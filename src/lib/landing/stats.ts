import { createHash } from "crypto";
import { UAParser } from "ua-parser-js";
import { prisma } from "@/lib/prisma";
import { localDateParts } from "@/lib/business-day";

// Список неполный по определению (докс: "фильтрация ботов по user-agent" —
// эвристика, не гарантия) — покрывает основные поисковые/соцсети-краулеры и
// самые частые HTTP-библиотеки, которых достаточно, чтобы не засорять
// статистику массовыми автоматическими заходами.
const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|telegrambot|whatsapp|vkshare|embedly|quora link preview|pinterest|redditbot|applebot|petalbot|semrush|ahrefs|mj12bot|dotbot|curl|wget|python-requests|python-urllib|go-http-client|java\/|okhttp|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|pingdom|uptimerobot|gtmetrix/i;

export function isBotUserAgent(userAgent: string): boolean {
  if (!userAgent) return true; // пустой UA — не настоящий браузер посетителя
  return BOT_UA_PATTERN.test(userAgent);
}

const SEARCH_DOMAINS = ["google.", "bing.", "yandex.", "duckduckgo.", "baidu.", "yahoo."];
const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "t.me",
  "telegram.org",
  "vk.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "whatsapp.com",
  "viber.com",
  "ok.ru",
  "threads.net",
];

// Ровно три категории (докс: "прямые/поиск/соцсети") — нераспознанный или
// пустой referrer учитывается как "прямой", отдельного бакета "прочее" нет.
export function classifySource(referer: string | null, ownOrigin: string): "direct" | "search" | "social" {
  if (!referer) return "direct";
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return "direct";
  }
  if (host === ownOrigin.toLowerCase() || host.endsWith(`.${ownOrigin.toLowerCase()}`)) return "direct";
  if (SEARCH_DOMAINS.some((d) => host.includes(d))) return "search";
  if (SOCIAL_DOMAINS.some((d) => host.includes(d))) return "social";
  return "direct";
}

export function classifyDevice(userAgent: string): "mobile" | "desktop" {
  const type = new UAParser(userAgent).getDevice().type;
  return type === "mobile" || type === "tablet" ? "mobile" : "desktop";
}

// "Соль дня" (докс: "hash(IP+UA+соль дня)") — сам секрет (LANDING_STATS_SALT)
// не должен утекать в БД или логи, только его производная через дневную дату
// участвует в хэше визитора. Дневная ротация — дополнительный слой: даже при
// доступе к БД нельзя сопоставить хэш одного и того же реального посетителя
// между разными днями, не только "смотреть на дату колонки".
function dailySalt(dateKey: string): string {
  const secret = process.env.LANDING_STATS_SALT ?? "dev-insecure-landing-stats-salt";
  return createHash("sha256").update(`${secret}:${dateKey}`).digest("hex");
}

function dateKeyFor(at: Date, timezone: string): { dateKey: string; date: Date } {
  const { year, month, day } = localDateParts(at, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateKey = `${year}-${pad(month)}-${pad(day)}`;
  return { dateKey, date: new Date(Date.UTC(year, month - 1, day)) };
}

function hashVisitor(ip: string, userAgent: string, dateKey: string): string {
  return createHash("sha256").update(`${ip}|${userAgent}|${dailySalt(dateKey)}`).digest("hex");
}

/**
 * Инкремент дневных агрегатов на один реальный визит (докс: "Статистика
 * посещений"). Вызывается из proxy.ts на каждый GET к /site/{slug}
 * опубликованного лендинга (боты и превью-режим уже отфильтрованы там).
 * "Уникальный" считается один раз в сутки через LandingVisitorSeen —
 * не хранит ничего, кроме хэша (докс: "сырые события НЕ хранятся").
 */
export async function recordLandingVisit(params: {
  landingId: string;
  timezone: string;
  ip: string;
  userAgent: string;
  referer: string | null;
  ownOrigin: string;
}) {
  const { landingId, timezone, ip, userAgent, referer, ownOrigin } = params;
  const now = new Date();
  const { dateKey, date } = dateKeyFor(now, timezone);
  const visitorHash = hashVisitor(ip, userAgent, dateKey);
  const source = classifySource(referer, ownOrigin);
  const device = classifyDevice(userAgent);

  let isNewUnique = false;
  try {
    await prisma.landingVisitorSeen.create({ data: { landingId, date, visitorHash } });
    isNewUnique = true;
  } catch {
    // @@unique([landingId, date, visitorHash]) — уже видели этого визитора
    // сегодня, это ожидаемый путь, не ошибка.
  }

  // Явные ветки по source/device, не computed property names — иначе
  // сгенерированные Prisma-типы для upsert не проверятся статически (ключи
  // там литеральные union, не произвольная строка).
  await prisma.landingDailyStat.upsert({
    where: { landingId_date: { landingId, date } },
    create: {
      landingId,
      date,
      visits: 1,
      uniqueVisitors: isNewUnique ? 1 : 0,
      sourceDirect: source === "direct" ? 1 : 0,
      sourceSearch: source === "search" ? 1 : 0,
      sourceSocial: source === "social" ? 1 : 0,
      deviceMobile: device === "mobile" ? 1 : 0,
      deviceDesktop: device === "desktop" ? 1 : 0,
    },
    update: {
      visits: { increment: 1 },
      ...(isNewUnique ? { uniqueVisitors: { increment: 1 } } : {}),
      ...(source === "direct" ? { sourceDirect: { increment: 1 } } : {}),
      ...(source === "search" ? { sourceSearch: { increment: 1 } } : {}),
      ...(source === "social" ? { sourceSocial: { increment: 1 } } : {}),
      ...(device === "mobile" ? { deviceMobile: { increment: 1 } } : {}),
      ...(device === "desktop" ? { deviceDesktop: { increment: 1 } } : {}),
    },
  });
}

/**
 * Чистка суточного дедуп-набора хэшей старше вчерашнего дня (докс:
 * LandingVisitorSeen — "после того как день закрыт, сам хэш больше не
 * нужен"). Best-effort, вызывается нечасто (раз на N визитов) прямо из
 * proxy.ts — отдельного крона в self-hosted single-container деплое
 * заводить не требуется, см. docs/spec/08-landing.md, Шаг 3.
 */
export async function pruneOldVisitorHashes(): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  await prisma.landingVisitorSeen.deleteMany({ where: { date: { lt: cutoff } } }).catch(() => {});
}
