import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Экранирование ячейки CSV — оборачиваем в кавычки, если значение содержит
// разделитель/кавычку/перенос строки (имя клиента — свободный текст,
// теоретически может содержать точку с запятой).
function csvCell(value: string): string {
  if (/[";\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Экспорт клиентов в CSV (запрос пользователя 2026-07-27) — Excel открывает
// CSV нативно, отдельная xlsx-библиотека ради трёх колонок не нужна.
// Разделитель — ";", не ",": у Excel с русской локалью запятая уже занята
// под десятичный разделитель, при двойном клике по .csv он не разобьёт
// строки на колонки. BOM в начале файла — иначе Excel показывает кириллицу
// (имена клиентов) битыми символами, читая файл не как UTF-8.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const wallets = await prisma.abonementWallet.findMany({
    where: { tenantId: owner.tenantId },
    orderBy: { createdAt: "desc" },
    select: { name: true, phone: true, balance: true },
  });

  const rows = [
    ["Name", "Phone", "Balance"].join(";"),
    // "+" перед телефоном — запрос пользователя 2026-07-27: в базе номер
    // хранится только цифрами (normalizePhone), без "+" Excel имеет
    // обыкновение читать длинную цифровую строку как число и обрезать её
    // (или перевести в экспоненциальную запись) — с "+" ячейка однозначно
    // текстовая.
    ...wallets.map((w) => [csvCell(w.name ?? ""), csvCell(`+${w.phone}`), String(Number(w.balance))].join(";")),
  ];

  // U+FEFF в начале файла — иначе Excel открывает CSV не как UTF-8 и
  // кириллица (имена клиентов) превращается в набор битых символов.
  const BOM = "﻿";
  const csv = BOM + rows.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="clients.csv"',
    },
  });
}
