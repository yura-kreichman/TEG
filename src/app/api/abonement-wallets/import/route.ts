import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";
import {
  IMPORT_MAX_FILE_SIZE,
  IMPORT_MAX_ROWS,
  analyzeImportRows,
  commitImport,
  readImportFile,
} from "@/lib/abonement-import";

// Импорт клиентов при переезде с другого ПО (запрос пользователя 2026-08-02).
//
// Один роут на два шага, различаются полем формы `commit`:
//   без него — предпросмотр, НИЧЕГО не пишется;
//   commit=1 — запись.
//
// Файл присылается оба раза и оба раза разбирается заново на сервере. Это
// сознательно: если бы шаг записи принимал уже разобранные строки от
// браузера, владелец (или кто угодно с его сессией) мог бы прислать любые
// телефоны и любые балансы в обход всех проверок — то есть завести себе
// деньги на кошельках напрямую. Файлы тут маленькие, вторая загрузка ничего
// не стоит.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const commit = formData.get("commit") === "1";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (file.size > IMPORT_MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Файл слишком большой (максимум 2 МБ)" }, { status: 400 });
  }

  let rawRows: unknown[][];
  try {
    rawRows = await readImportFile(file);
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать файл — нужен .xlsx или .csv в формате образца" },
      { status: 400 }
    );
  }

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "Файл пустой" }, { status: 400 });
  }
  if (rawRows.length > IMPORT_MAX_ROWS + 1) {
    return NextResponse.json(
      { error: `Слишком много строк (максимум ${IMPORT_MAX_ROWS}) — разбейте файл на части` },
      { status: 400 }
    );
  }

  // Занятые телефоны берём целиком по тенанту, а не запросом на каждую
  // строку: при переезде база клиентов обычно пустая или маленькая, а
  // пять тысяч точечных запросов на предпросмотр — нет.
  const existingPhones = new Set(
    (
      await prisma.abonementWallet.findMany({
        where: { tenantId: owner.tenantId },
        select: { phone: true },
      })
    ).map((w) => w.phone)
  );

  const analysis = analyzeImportRows(rawRows, existingPhones);

  if (!commit) {
    return NextResponse.json({
      newCount: analysis.newCount,
      errorCount: analysis.errorCount,
      existingCount: analysis.rows.filter((r) => r.error === "alreadyExists").length,
      duplicateCount: analysis.rows.filter((r) => r.error === "duplicateInFile").length,
      // Проблемные строки — с номером строки файла, чтобы владелец нашёл их
      // в своём Excel, а не гадал. Ограничение в 50 строк — предпросмотр
      // должен оставаться читаемым; общее число всё равно в счётчиках выше.
      problems: analysis.rows
        .filter((r) => r.error !== null)
        .slice(0, 50)
        .map((r) => ({ line: r.line, phone: r.rawPhone, name: r.name, error: r.error })),
    });
  }

  if (analysis.newCount === 0) {
    return NextResponse.json({ error: "В файле нет ни одной строки для импорта" }, { status: 400 });
  }

  const { created } = await commitImport(owner.tenantId, owner.user.id, analysis.rows);

  return NextResponse.json({
    created,
    skipped: analysis.rows.length - created,
  });
}
