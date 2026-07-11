// Client-safe (no fs/path) — split out of icon-library.ts so the icon picker
// (a client component) doesn't pull Node's `fs` into the browser bundle.
// "avatars" — отдельная коллекция для Оператора (не для Точки/Зоны/Актива),
// поэтому не входит в GENERAL_ICON_FAMILIES (список для обычного переключателя
// семейств) — picker для оператора запирается на неё через families=["avatars"].
// "app-icons" — фиксированные декоративные SVG-иконки самого приложения
// (кнопки PWA оператора и т.п., НЕ путать с public/icon-library/pwa/ — там
// PNG-иконки манифеста для установки PWA на главный экран, разные назначения),
// не выбираются пользователем ни в каком picker'е — добавлены в список только
// чтобы /api/icon-library/[family]/[name] их отдавал.
export const ICON_FAMILIES = ["fluent", "material", "avatars", "app-icons"] as const;
export type IconFamily = (typeof ICON_FAMILIES)[number];

export const GENERAL_ICON_FAMILIES = ["fluent", "material"] as const;

export function isIconFamily(value: string): value is IconFamily {
  return (ICON_FAMILIES as readonly string[]).includes(value);
}
