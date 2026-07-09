import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { isIconFamily, listIconNames } from "@/lib/icon-library";

// Список имён иконок в выбранной коллекции — для поиска в IconPicker
// (owner-only, тот же список используют формы создания/правки Точки/Зоны/Актива).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const family = searchParams.get("family") ?? "";
  if (!isIconFamily(family)) {
    return NextResponse.json({ error: "Некорректная коллекция иконок" }, { status: 400 });
  }

  const query = searchParams.get("q") ?? undefined;
  return NextResponse.json({ icons: listIconNames(family, query) });
}
