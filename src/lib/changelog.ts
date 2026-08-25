import data from "@changelog/releases.json";
import { isLocale, type Locale } from "@/lib/locales";

// Публичная история изменений (changelog/README.md). Файл releases.json —
// СГЕНЕРИРОВАННЫЙ: его собирает scripts/build-changelog.mjs из seed.json и
// трейлеров `Changelog:` в коммитах, и пересобирает на каждом деплое. Здесь он
// только читается.
//
// Даты релизов в файле есть (поле day), но наружу не отдаются вовсе — решение
// владельца 2026-08-25: список версий без дат. Поэтому в типах ниже day и нет.

export type ChangeType = "feat" | "impr" | "fix";

export type ChangeEntry = {
  type: ChangeType;
  text: { ru?: string; en?: string };
};

export type Release = {
  version: string;
  entries: ChangeEntry[];
};

// Порядок вывода внутри релиза: сначала что появилось, потом что стало лучше,
// потом что починили.
export const CHANGE_TYPE_ORDER: ChangeType[] = ["feat", "impr", "fix"];

export const releases: Release[] = (data.releases as Release[]).map((r) => ({
  version: r.version,
  entries: r.entries,
}));

export const currentVersion: string = data.version ?? releases[0]?.version ?? "1.0.0";

// Тексты записей ведутся на двух языках (решение владельца 2026-08-25).
// Цепочка выбора: язык читателя → английский → русский. Любой другой язык
// интерфейса получает английский текст, и это осознанно: обвязка страницы
// переведена на все 15, а сама история — нет.
export function entryText(entry: ChangeEntry, locale: Locale): string {
  const own = (entry.text as Record<string, string | undefined>)[locale];
  return own ?? entry.text.en ?? entry.text.ru ?? "";
}

// Страница публичная: сессии нет, cookie кабинета читать нельзя (это сделало бы
// её динамической). Язык приходит параметром ?lang= из подвала сайта, где он
// известен, — всё остальное отдаём на русском.
export function localeFromParam(value: string | string[] | undefined): Locale {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && isLocale(raw) ? raw : "ru";
}
