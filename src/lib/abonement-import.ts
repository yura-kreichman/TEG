import readXlsxFile from "read-excel-file/node";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/abonement";

// Импорт клиентов при переезде с другого ПО (запрос пользователя 2026-08-02).
// Формат файла — ровно тот же, что у экспорта (/api/abonement-wallets/export):
// Телефон | пустая колонка | Имя | Баланс. Пустая вторая колонка выглядит
// странно, но это осознанный формат экспорта (запрос 2026-07-28, дословный
// порядок колонок), и импорт обязан читать именно его — иначе владелец не
// сможет выгрузить из RentOS и залить обратно.
//
// ВАЖНО про деньги: импортированный баланс НЕ проводится как пополнение.
// Деньги за него владелец уже получил в старой системе, и попади они в
// MoneyOperation — в "Деньгах" и отчётах RentOS появилась бы выручка,
// которой не было. Запись идёт транзакцией типа "migration" (см.
// MIGRATION_TX_TYPE), рядом с "adjustment", который тоже не пишет в денежный
// журнал. Отдельный тип, а не переиспользованный adjustment — чтобы в выписке
// клиента было видно, что баланс перенесён, а не поправлен владельцем руками
// (решение пользователя из трёх предложенных вариантов).
export const MIGRATION_TX_TYPE = "migration";

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 МБ

export type ImportRowError = "phone" | "balance" | "duplicateInFile" | "alreadyExists";

export interface ParsedImportRow {
  /** Номер строки в исходном файле, как его видит владелец в Excel (с учётом заголовка). */
  line: number;
  rawPhone: string;
  phone: string;
  name: string | null;
  balance: number;
  error: ImportRowError | null;
}

export interface ImportAnalysis {
  rows: ParsedImportRow[];
  newCount: number;
  errorCount: number;
}

function parseBalance(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  // Выгрузки из чужого ПО приходят как угодно: "1 200,50", "1,200.50",
  // "1200.5 ₽", неразрывные пробелы из Excel. Срезаем всё, кроме цифр,
  // запятой, точки и минуса, запятую приводим к точке.
  const cleaned = raw
    .replace(/[^\d,.-]/g, "")
    .replace(/,/g, ".")
    // "1.200.50" — тысячные точки: оставляем последнюю как десятичную.
    .replace(/\.(?=.*\.)/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function cellToString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return "";
  return String(raw).trim();
}

/**
 * Заголовок пропускается, только если первая ячейка действительно не похожа
 * на телефон — файл из чужой системы может прийти и без строки заголовков,
 * и молча съеденная первая строка означала бы потерянного клиента.
 */
function dropHeader(rows: unknown[][]): { rows: unknown[][]; offset: number } {
  const first = rows[0];
  if (!first) return { rows, offset: 1 };
  const firstCell = cellToString(first[0]);
  const looksLikeHeader = firstCell !== "" && normalizePhone(firstCell).length < 5;
  return looksLikeHeader ? { rows: rows.slice(1), offset: 2 } : { rows, offset: 1 };
}

function parseCsv(text: string): unknown[][] {
  // Экспорт RentOS — .xlsx, но старое ПО чаще отдаёт именно CSV (решение
  // пользователя принимать оба). Свой мини-разбор вместо ещё одной
  // зависимости: нужен ровно один диалект — кавычки, удвоенные кавычки
  // внутри, разделитель "," или ";" (европейский Excel).
  const stripped = text.replace(/^﻿/, "");
  const delimiter = (stripped.split("\n")[0] ?? "").includes(";") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if (quoted) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export async function readImportFile(file: File): Promise<unknown[][]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  if (isCsv) return parseCsv(buffer.toString("utf8"));
  // read-excel-file принимает Buffer/Stream в node-сборке; не-xlsx файл
  // (например, переименованный .doc) валится здесь, и вызывающий роут
  // превращает это в понятную ошибку, а не в 500.
  return (await readXlsxFile(buffer)) as unknown as unknown[][];
}

/**
 * Чистый разбор + классификация, без единого обращения к БД, кроме готового
 * набора уже занятых телефонов — так функция целиком покрывается тестами, а
 * предпросмотр и сам импорт гарантированно считают одно и то же.
 */
export function analyzeImportRows(rows: unknown[][], existingPhones: Set<string>): ImportAnalysis {
  const { rows: dataRows, offset } = dropHeader(rows);
  const seenInFile = new Set<string>();
  const result: ParsedImportRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    // Колонки строго как в экспорте: A — телефон, B пустая, C — имя,
    // D — баланс. Угадывать сдвинутые колонки намеренно НЕ пытаемся: тихо
    // принятое за баланс имя (или наоборот) хуже, чем честная красная
    // строка в предпросмотре, где владелец сразу видит, что разобралось.
    const row = dataRows[i] ?? [];
    const rawPhone = cellToString(row[0]);
    const name = cellToString(row[2]);
    const rawBalance = cellToString(row[3]);

    // Полностью пустая строка (хвост файла из Excel) — не ошибка, просто
    // пропускаем, чтобы не пугать владельца красными строками на ровном месте.
    if (rawPhone === "" && name === "" && rawBalance === "") continue;

    const phone = normalizePhone(rawPhone);
    const balance = parseBalance(row[3]);

    let error: ImportRowError | null = null;
    // Минимум 5 цифр — отсекает мусор вроде "—" или "нет", но не мешает
    // коротким местным номерам; строгую валидацию по странам здесь
    // намеренно не делаем, номера в чужой базе могут быть какими угодно.
    if (phone.length < 5) error = "phone";
    else if (balance === null || balance < 0) error = "balance";
    else if (seenInFile.has(phone)) error = "duplicateInFile";
    else if (existingPhones.has(phone)) error = "alreadyExists";

    if (!error) seenInFile.add(phone);

    result.push({
      line: i + offset,
      rawPhone,
      phone,
      name: name || null,
      balance: balance ?? 0,
      error,
    });
  }

  return {
    rows: result,
    newCount: result.filter((r) => r.error === null).length,
    // "Уже есть" и "дубликат внутри файла" — не ошибки владельца, а
    // ожидаемый исход (решение пользователя: существующих пропускаем).
    // В счётчик ошибок идут только реально нечитаемые строки.
    errorCount: result.filter((r) => r.error === "phone" || r.error === "balance").length,
  };
}

// Пишем порциями, а не одной транзакцией на весь файл: при переезде это
// тысячи строк, и одна длинная транзакция на маленьком проде (PG_TUNE_TOTAL_MB
// =512, docker-compose.prod.yml) держала бы блокировки заметно дольше, чем
// нужно. Порция целиком атомарна — кошельки и их транзакции появляются
// вместе, промежуточного состояния "баланс есть, истории нет" не бывает.
const IMPORT_CHUNK = 200;

/**
 * Создаёт клиентов из уже разобранных и проверенных строк.
 *
 * Уведомления об изменении баланса здесь сознательно НЕ шлются (в отличие от
 * ручной корректировки владельца, см. createWalletWithAdjustment): при
 * переезде это сотни клиентов разом, и рассылка "ваш баланс изменён" по всей
 * базе в момент импорта — последнее, чего хочет владелец. Привязок к Telegram
 * у только что перенесённых клиентов и так ещё нет.
 */
export async function commitImport(
  tenantId: string,
  userId: string,
  rows: ParsedImportRow[]
): Promise<{ created: number; skipped: number }> {
  const importable = rows.filter((r) => r.error === null);
  let created = 0;

  for (let i = 0; i < importable.length; i += IMPORT_CHUNK) {
    const chunk = importable.slice(i, i + IMPORT_CHUNK);

    const createdInChunk = await prisma.$transaction(async (tx) => {
      // Проверка занятости телефонов ВНУТРИ транзакции, а не только по
      // снимку из предпросмотра: между показом списка и нажатием кнопки
      // оператор на точке мог завести того же клиента вручную. Без этого
      // строка истории "перенос" прицепилась бы к чужому кошельку, который
      // мы не создавали, и его выписка перестала бы сходиться с балансом.
      const phones = chunk.map((r) => r.phone);
      const taken = new Set(
        (
          await tx.abonementWallet.findMany({
            where: { tenantId, phone: { in: phones } },
            select: { phone: true },
          })
        ).map((w) => w.phone)
      );

      const toCreate = chunk.filter((r) => !taken.has(r.phone));
      if (toCreate.length === 0) return 0;

      // skipDuplicates — страховка на ту же гонку в оставшиеся миллисекунды:
      // без него вся порция упала бы на уникальном индексе (tenantId, phone)
      // из-за одной чужой строки.
      await tx.abonementWallet.createMany({
        data: toCreate.map((r) => ({ tenantId, phone: r.phone, name: r.name, balance: r.balance })),
        skipDuplicates: true,
      });

      // createMany не возвращает id — добираем их отдельным запросом по тем
      // же телефонам, чтобы привязать транзакции истории.
      const wallets = await tx.abonementWallet.findMany({
        where: { tenantId, phone: { in: toCreate.map((r) => r.phone) } },
        select: { id: true, phone: true },
      });
      const idByPhone = new Map(wallets.map((w) => [w.phone, w.id]));

      const historyRows = toCreate
        .map((r) => ({ walletId: idByPhone.get(r.phone), amount: r.balance }))
        .filter((r): r is { walletId: string; amount: number } => Boolean(r.walletId))
        // Нулевой стартовый баланс — клиент переехал, но денег на нём не
        // было: строка в истории про перенос нуля только засоряет выписку.
        .filter((r) => r.amount > 0)
        .map((r) => ({ walletId: r.walletId, type: MIGRATION_TX_TYPE, amount: r.amount, userId }));

      if (historyRows.length > 0) await tx.abonementTransaction.createMany({ data: historyRows });

      return toCreate.length;
    });

    created += createdInChunk;
  }

  return { created, skipped: rows.length - created };
}
