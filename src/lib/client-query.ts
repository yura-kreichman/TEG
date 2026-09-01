/**
 * Разбор строки поиска клиента — общий словарь сервера и интерфейса
 * (запрос пользователя 2026-09-01: "искать по последним четырём цифрам
 * телефона" и "так же по имени и фамилии").
 *
 * Отдельный файл от lib/abonement.ts осознанно: тот тянет prisma и в
 * клиентский компонент не импортируется, а классификация запроса нужна ровно
 * в обоих местах — иначе поле ввода и роут разъедутся в том, что считать
 * достаточным запросом.
 */

/** Только цифры — как номер и хранится в базе (AbonementWallet.phone). */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Минимум цифр для поиска по хвосту номера. Четыре — из запроса пользователя.
 * Ниже опускать нельзя: три цифры у тенанта с тысячами клиентов дают уже не
 * список кандидатов, а перебор базы.
 */
export const PHONE_SEARCH_MIN_DIGITS = 4;

/**
 * Минимум цифр, чтобы ЗАВЕСТИ кошелёк. Восемь — та же длина, что у
 * AbonementWallet.phoneKey (национальный номер в Молдове), и она же отделяет
 * "человек продиктовал номер" от "сотрудник набрал хвост, чтобы найти".
 *
 * Зачем порог именно на создании: до этой правки хватало одной цифры, и
 * поиск, ничего не найдя, предлагал завести клиента с номером «4242» —
 * мусорная строка навсегда занимала бы @@unique([tenantId, phone]) и никогда
 * не сошлась бы ни с ботом, ни с повторным визитом того же человека. С
 * коротким поиском эта дыра из редкой стала бы ежедневной.
 *
 * НЕ применяется к импорту кошельков владельцем (/api/abonement-wallets/
 * import) — там осознанное массовое действие с уже существующими данными,
 * и обрезать чужую историю по нашему порогу нельзя.
 */
export const PHONE_CREATE_MIN_DIGITS = 8;

/** Потолок выдачи кандидатов — дальше просим уточнить запрос. */
export const CLIENT_SEARCH_LIMIT = 20;

/** В строке есть буква любого алфавита — значит ищут по имени, не по номеру. */
export function hasLetters(raw: string): boolean {
  return /\p{L}/u.test(raw);
}

/**
 * Что делать с введённой строкой:
 * - `empty`  — пусто, искать нечего;
 * - `name`   — есть буквы, ищем по имени;
 * - `tooShort` — только цифры, но их меньше четырёх;
 * - `tail`   — 4–7 цифр, хвост номера: ТОЛЬКО список кандидатов;
 * - `phone`  — 8+ цифр, полноценный номер: точное совпадение, иначе кандидаты
 *              по phoneKey (прежнее поведение, не менялось).
 */
export type ClientQueryKind = "empty" | "name" | "tooShort" | "tail" | "phone";

export function classifyClientQuery(raw: string): ClientQueryKind {
  const query = raw.trim();
  if (!query) return "empty";
  if (hasLetters(query)) return "name";
  const digits = normalizePhone(query);
  if (digits.length >= PHONE_CREATE_MIN_DIGITS) return "phone";
  if (digits.length >= PHONE_SEARCH_MIN_DIGITS) return "tail";
  return "tooShort";
}

/** Годится ли строка как запрос поиска (кнопка «Найти» активна). */
export function isSearchableClientQuery(raw: string): boolean {
  const kind = classifyClientQuery(raw);
  return kind === "name" || kind === "tail" || kind === "phone";
}

/** Годится ли строка как номер НОВОГО клиента. */
export function isCreatableClientPhone(raw: string): boolean {
  return !hasLetters(raw) && normalizePhone(raw).length >= PHONE_CREATE_MIN_DIGITS;
}
