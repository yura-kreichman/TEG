import { NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";
import { requireOwner } from "@/lib/require-owner";
import { isModuleEnabled } from "@/lib/tenant-modules";

// Образец файла для импорта клиентов (запрос пользователя 2026-08-02:
// "Владелец должен видеть образец (скачать его)").
//
// Отдельный файл, а не "выгрузите экспорт и посмотрите": импорт нужен ровно
// тем, кто ТОЛЬКО ЧТО переехал с другого ПО, а у них экспорт вернёт пустой
// файл с одними заголовками — по нему не понять ни в каком виде писать
// телефон, ни как оформлять баланс. Поэтому здесь те же заголовки плюс
// строки-примеры.
//
// Колонки обязаны совпадать с /api/abonement-wallets/export (Телефон, пустая
// колонка, Имя, Баланс) — иначе выгруженный из RentOS файл нельзя было бы
// залить обратно. Пустая колонка B выглядит странно, но это осознанный
// формат экспорта (запрос 2026-07-28), и расходиться с ним нельзя.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const sheetData = [
    [
      { value: "Phone", fontWeight: "bold" as const },
      { value: "", fontWeight: "bold" as const },
      { value: "Name", fontWeight: "bold" as const },
      { value: "Balance", fontWeight: "bold" as const },
    ],
    // Телефоны примеров — тип String, как в экспорте: иначе Excel угадает их
    // как число и покажет в экспоненциальной записи, а владелец решит, что
    // так и надо заполнять.
    [
      { value: "+79991234567", type: String },
      { value: "" },
      { value: "Анна Иванова", type: String },
      { value: 1500, type: Number, format: "#,##0.00" },
    ],
    [
      { value: "+79997654321", type: String },
      { value: "" },
      { value: "Борис Петров", type: String },
      { value: 0, type: Number, format: "#,##0.00" },
    ],
    [
      { value: "+79995556677", type: String },
      { value: "" },
      // Имя необязательно — показываем это прямо в образце, чтобы владелец
      // не выдумывал заглушки для клиентов, которых знает только по номеру.
      { value: "", type: String },
      { value: 320.5, type: Number, format: "#,##0.00" },
    ],
  ];

  const buffer = await writeExcelFile(sheetData).toBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="clients-template.xlsx"',
    },
  });
}
