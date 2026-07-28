import { NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { getCurrencySign } from "@/lib/currency";

// Экспорт клиентов (запрос пользователя 2026-07-27, формат колонок и переход
// на настоящий .xlsx — запрос 2026-07-28: "не csv и именно xlsx файл").
// write-excel-file — минимальная зависимость (единственный transitive-пакет
// fflate, без archiver/glob-хвоста, который тянет за собой exceljs) для
// генерации настоящего .xlsx на сервере, не CSV с расширением ".xlsx".
//
// Порядок колонок — Телефон, пустая колонка, Имя, Баланс (запрос
// пользователя 2026-07-28, дословно). Типы ячеек — тоже по запросу того же
// дня: телефон и имя ЯВНО String (иначе Excel может угадать телефон как
// число и обрезать/перевести в экспоненциальную запись — тот же риск, что
// раньше решался префиксом "+" в CSV, тут решается настоящим типом ячейки),
// баланс — Number с денежным форматом, символ валюты — реальный знак
// тенанта (Tenant.currency, тот же справочник CURRENCIES, что и на
// экранах), не захардкоженный ₽.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const [wallets, tenant] = await Promise.all([
    prisma.abonementWallet.findMany({
      where: { tenantId: owner.tenantId },
      orderBy: { createdAt: "desc" },
      select: { name: true, phone: true, balance: true },
    }),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { currency: true } }),
  ]);

  const currencySign = getCurrencySign(tenant?.currency);
  // Знак — литерал внутри кастомного числового формата Excel, в кавычках
  // (стандартный синтаксис "#,##0.00 "₽""); без валюты у тенанта (ещё не
  // выбрана) — обычный числовой формат без знака, не пустая строка-заглушка.
  const balanceFormat = currencySign ? `#,##0.00 "${currencySign}"` : "#,##0.00";

  const sheetData = [
    [
      { value: "Phone", fontWeight: "bold" as const },
      { value: "", fontWeight: "bold" as const },
      { value: "Name", fontWeight: "bold" as const },
      { value: "Balance", fontWeight: "bold" as const },
    ],
    ...wallets.map((w) => [
      { value: `+${w.phone}`, type: String },
      { value: "" },
      { value: w.name ?? "", type: String },
      { value: Number(w.balance), type: Number, format: balanceFormat },
    ]),
  ];

  const buffer = await writeExcelFile(sheetData).toBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="clients.xlsx"',
    },
  });
}
