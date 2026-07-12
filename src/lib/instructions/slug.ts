// Транслитерация кириллицы → латиница для человекочитаемых slug'ов
// (docs/spec/07-instructions.md, "Tenant.slug"/"Instruction.slug") — своя
// таблица, не библиотека: набор символов маленький и фиксированный, лишняя
// зависимость не нужна.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugify(text: string): string {
  const transliterated = text
    .toLowerCase()
    .split("")
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("");

  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Числовой суффикс при коллизии (tenant-slug, tenant-slug-2, ...) — checkExists
// принимает кандидат и возвращает true, если он уже занят (запрос к БД
// остаётся на стороне вызывающего кода, эта функция не знает про Prisma).
export async function generateUniqueSlug(
  base: string,
  checkExists: (candidate: string) => Promise<boolean>
): Promise<string> {
  const root = slugify(base) || "tenant";
  let candidate = root;
  let suffix = 2;
  while (await checkExists(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix++;
  }
  return candidate;
}
