import { NextResponse } from "next/server";
import { isIconFamily, readIconSvg } from "@/lib/icon-library";

// Отдаёт сырой SVG иконки из личной коллекции (icon-library/<family>/<name>.svg).
// Без авторизации — как /uploads/*, это декоративная графика, а не пользовательские
// данные, и её должен уметь отрисовать и оператор (AssetOrZoneIcon в мастере
// сдачи итогов), у которого нет сессии владельца.
export async function GET(_request: Request, ctx: RouteContext<"/api/icon-library/[family]/[name]">) {
  const { family, name: rawName } = await ctx.params;
  if (!isIconFamily(family)) {
    return NextResponse.json({ error: "Некорректная коллекция иконок" }, { status: 400 });
  }

  // iconSrc() (src/components/icon-picker.tsx) строит URL как .../<name>.svg —
  // readIconSvg сам добавляет расширение, поэтому здесь его нужно снять, иначе
  // ищется "<name>.svg.svg" и любая иконка отдаёт 404 (см. icon-library.ts).
  const name = rawName.replace(/\.svg$/i, "");
  const svg = readIconSvg(family, name);
  if (svg === null) {
    return NextResponse.json({ error: "Иконка не найдена" }, { status: 404 });
  }

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      // Статичный файл коллекции, не пользовательские данные — можно кэшировать
      // надолго (запрос пользователя 2026-07-22: "каждый раз загружаются в icon
      // picker"). immutable безопасен даже при пополнении коллекции новыми SVG
      // (это просто новые URL) — небезопасен только при ПЕРЕЗАПИСИ существующего
      // файла под тем же именем, тогда браузеры с уже закэшированной версией не
      // увидят замену до истечения года.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
