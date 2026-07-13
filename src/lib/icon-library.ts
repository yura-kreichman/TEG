import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { type IconFamily } from "@/lib/icon-families";

export { ICON_FAMILIES, isIconFamily, type IconFamily } from "@/lib/icon-families";

// Личная коллекция SVG-иконок в public/icon-library/<family>/ (см.
// public/icon-library/README.md) заменяет прежний набор из lucide-react/dynamic.
// Плоские папки без манифеста — имя файла (без .svg) и есть ключевые слова для
// поиска, файловая система сама служит индексом. В public/, а не в корне
// проекта — там же теперь и иконки PWA-манифеста (public/icon-library/pwa/),
// чтобы все иконки проекта хранились в одном месте. Server-only (fs/path) —
// не импортировать из клиентских компонентов, для этого есть icon-families.ts.
//
// Имя файла используется как один сегмент пути (join(dir, name + ".svg")) —
// единственная реальная опасность это выход за пределы папки (".."/"."/слеши),
// а не конкретный набор символов. Реальные наборы иконок называют файлы как
// угодно (пробелы, подчёркивания, заглавные буквы, апострофы — "Jack O'Lantern.svg"),
// поэтому запрет был осознанно широким ("только a-z0-9-"), но это молча ломало
// показ любой иконки с другим именем (readIconSvg возвращал null => 404) —
// сузили проверку до того, что действительно небезопасно.
const FORBIDDEN_CHARS = /[/\\\0]/;

export function isIconName(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !FORBIDDEN_CHARS.test(value);
}

function libraryDir(family: IconFamily) {
  return join(process.cwd(), "public", "icon-library", family);
}

export function listIconNames(family: IconFamily): string[] {
  let names: string[];
  try {
    names = readdirSync(libraryDir(family))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4));
  } catch {
    return [];
  }
  return names.sort();
}

export function readIconSvg(family: IconFamily, name: string): string | null {
  if (!isIconName(name)) return null;
  try {
    return readFileSync(join(libraryDir(family), `${name}.svg`), "utf8");
  } catch {
    return null;
  }
}
