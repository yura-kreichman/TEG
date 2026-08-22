import { LOCALE_TIMEZONES } from "@/lib/locales";

/**
 * Регион владельца по его часовому поясу — «откуда возможный новый клиент»
 * (запрос владельца 2026-08-22). Отдельного поля страны у тенанта нет и
 * заводить его не за чем: пояс владелец выставляет сам при первой настройке,
 * и он привязан к месту работы точнее, чем IP регистрации (VPN, поездка) или
 * язык интерфейса (русский язык ≠ Россия — половина наших тенантов).
 *
 * Таблица покрывает страны наших языков (их зоны и так первыми в пикере) плюс
 * ходовые страны остального мира. Для всего, чего в ней нет, показываем
 * регион так, как его называет сам ICU по-русски («Восточная Европа,
 * стандартное время») — это не страна, но масштаб понятен.
 */
const ZONES_BY_COUNTRY: Record<string, [name: string, zones: string[]]> = {
  RU: ["Россия", LOCALE_TIMEZONES.ru],
  UA: ["Украина", LOCALE_TIMEZONES.uk],
  MD: ["Молдова", ["Europe/Chisinau", "Europe/Tiraspol"]],
  RO: ["Румыния", ["Europe/Bucharest"]],
  BY: ["Беларусь", ["Europe/Minsk"]],
  PL: ["Польша", ["Europe/Warsaw"]],
  IT: ["Италия", ["Europe/Rome"]],
  UZ: ["Узбекистан", LOCALE_TIMEZONES.uz],
  KZ: ["Казахстан", LOCALE_TIMEZONES.kk],
  TJ: ["Таджикистан", ["Asia/Dushanbe"]],
  KG: ["Киргизия", ["Asia/Bishkek"]],
  AM: ["Армения", ["Asia/Yerevan"]],
  AZ: ["Азербайджан", ["Asia/Baku"]],
  GE: ["Грузия", ["Asia/Tbilisi"]],
  TR: ["Турция", ["Europe/Istanbul", "Asia/Istanbul"]],
  GB: ["Великобритания", ["Europe/London"]],
  IE: ["Ирландия", ["Europe/Dublin"]],
  DE: ["Германия", ["Europe/Berlin", "Europe/Busingen"]],
  FR: ["Франция", ["Europe/Paris"]],
  ES: ["Испания", ["Europe/Madrid", "Africa/Ceuta", "Atlantic/Canary"]],
  PT: ["Португалия", ["Europe/Lisbon", "Atlantic/Madeira", "Atlantic/Azores"]],
  NL: ["Нидерланды", ["Europe/Amsterdam"]],
  BE: ["Бельгия", ["Europe/Brussels"]],
  AT: ["Австрия", ["Europe/Vienna"]],
  CH: ["Швейцария", ["Europe/Zurich"]],
  CZ: ["Чехия", ["Europe/Prague"]],
  SK: ["Словакия", ["Europe/Bratislava"]],
  HU: ["Венгрия", ["Europe/Budapest"]],
  BG: ["Болгария", ["Europe/Sofia"]],
  GR: ["Греция", ["Europe/Athens"]],
  RS: ["Сербия", ["Europe/Belgrade"]],
  HR: ["Хорватия", ["Europe/Zagreb"]],
  SI: ["Словения", ["Europe/Ljubljana"]],
  LT: ["Литва", ["Europe/Vilnius"]],
  LV: ["Латвия", ["Europe/Riga"]],
  EE: ["Эстония", ["Europe/Tallinn"]],
  FI: ["Финляндия", ["Europe/Helsinki"]],
  SE: ["Швеция", ["Europe/Stockholm"]],
  NO: ["Норвегия", ["Europe/Oslo"]],
  DK: ["Дания", ["Europe/Copenhagen"]],
  CY: ["Кипр", ["Asia/Nicosia", "Asia/Famagusta"]],
  IL: ["Израиль", ["Asia/Jerusalem", "Asia/Tel_Aviv"]],
  AE: ["ОАЭ", ["Asia/Dubai"]],
  TH: ["Таиланд", ["Asia/Bangkok"]],
  ID: ["Индонезия", ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]],
  VN: ["Вьетнам", ["Asia/Ho_Chi_Minh", "Asia/Saigon"]],
  IN: ["Индия", ["Asia/Kolkata", "Asia/Calcutta"]],
  CN: ["Китай", ["Asia/Shanghai", "Asia/Urumqi"]],
  US: [
    "США",
    [
      "America/New_York",
      "America/Detroit",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ],
  ],
  CA: ["Канада", ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax"]],
  MX: ["Мексика", ["America/Mexico_City", "America/Cancun", "America/Tijuana"]],
  BR: ["Бразилия", ["America/Sao_Paulo", "America/Bahia", "America/Manaus"]],
  AR: ["Аргентина", ["America/Argentina/Buenos_Aires"]],
  AU: ["Австралия", ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide"]],
  NZ: ["Новая Зеландия", ["Pacific/Auckland"]],
};

const COUNTRY_BY_ZONE = new Map<string, { code: string; name: string }>();
for (const [code, [name, zones]] of Object.entries(ZONES_BY_COUNTRY)) {
  for (const zone of zones) COUNTRY_BY_ZONE.set(zone, { code, name });
}

/** Флаг страны из её ISO-кода — regional indicator symbols, без картинок. */
function flagOf(countryCode: string): string {
  return String.fromCodePoint(...[...countryCode].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Город из имени зоны: "America/Argentina/Buenos_Aires" → "Buenos Aires". */
function cityOf(timezone: string): string {
  const last = timezone.split("/").pop() ?? timezone;
  return last.replaceAll("_", " ");
}

function offsetLabel(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeZoneName: "shortOffset" }).formatToParts(now);
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // ICU по-русски отдаёт "GMT+3" — приводим к привычному в интерфейсе UTC.
    return name.replace("GMT", "UTC") || "UTC+0";
  } catch {
    return "";
  }
}

/** Как ICU называет сам регион пояса — фолбэк для стран не из таблицы. */
function regionLabel(timezone: string, now: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeZoneName: "long" }).formatToParts(now);
    const value = parts.find((p) => p.type === "timeZoneName")?.value ?? null;
    // "Фиджи, стандартное время" → "Фиджи": в списке важна география, а не
    // то, действует ли сейчас летнее время.
    return value ? value.replace(/,\s*(стандартное|летнее)\s+время$/i, "") : null;
  } catch {
    return null;
  }
}

function localTime(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return "";
  }
}

export interface TenantRegion {
  timezone: string;
  /** Страна из таблицы; null — зона в неё не попала. */
  country: string | null;
  countryFlag: string | null;
  city: string;
  /** "UTC+3" */
  offset: string;
  /** Текущее время у владельца — чтобы понимать, когда ему звонить. */
  localTime: string;
  /** Готовая строка для списка: "🇲🇩 Молдова · Chisinau · UTC+3 · 14:32". */
  label: string;
}

/**
 * Голый UTC — это не страна, а «пояс не определился»: при регистрации в
 * тенант пишется зона браузера (api/auth/register), и UTC остаётся у тех, кто
 * зарегистрировался до этого или пришёл с сервера/VPN. В админке честнее так
 * и написать, чем выдавать ICU-шное «Всемирное координированное время» за
 * регион клиента.
 */
const UNSET_ZONES = new Set(["UTC", "Etc/UTC", "Etc/GMT", "GMT"]);

export function describeTenantRegion(timezone: string, now: Date = new Date()): TenantRegion {
  if (UNSET_ZONES.has(timezone)) {
    const time = localTime(timezone, now);
    return {
      timezone,
      country: null,
      countryFlag: null,
      city: timezone,
      offset: "UTC+0",
      localTime: time,
      label: ["Пояс не определён", "UTC+0", time].filter(Boolean).join(" · "),
    };
  }

  const known = COUNTRY_BY_ZONE.get(timezone);
  const offset = offsetLabel(timezone, now);
  const time = localTime(timezone, now);
  const city = cityOf(timezone);
  // Страны нет в таблице — вместо неё название региона от ICU; если и его
  // нет (экзотическая зона), остаётся город из самого имени зоны.
  const area = known?.name ?? regionLabel(timezone, now);
  const label = [known ? `${flagOf(known.code)} ${known.name}` : area, city, offset, time]
    .filter((part): part is string => Boolean(part))
    // Город не дублируем, когда он и есть весь ответ (area === null).
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(" · ");
  return {
    timezone,
    country: known?.name ?? null,
    countryFlag: known ? flagOf(known.code) : null,
    city,
    offset,
    localTime: time,
    label,
  };
}
