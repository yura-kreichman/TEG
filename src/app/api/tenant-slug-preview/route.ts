import { NextResponse } from "next/server";
import { generateUniqueSlug } from "@/lib/instructions/slug";
import { isReservedSlug, isSlugTaken } from "@/lib/landing/slug";
import { requireOwner } from "@/lib/require-owner";

// Живое превью слага по названию компании (докс: показывается и при
// регистрации, и при переименовании — решение пользователя 2026-07-13).
// Публичный (без сессии работает для формы регистрации, где тенанта ещё
// нет); если сессия владельца есть — свой ТЕКУЩИЙ слаг исключается из
// проверки занятости (иначе владелец не смог бы "переименовать в то же
// самое" или на близкий вариант с тем же корнем). slugify уже сам
// игнорирует эмодзи/пунктуацию (не-[a-z0-9] схлопывается в "-").
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name") ?? "";
  if (!name.trim()) {
    return NextResponse.json({ slug: null });
  }

  const owner = await requireOwner();

  const slug = await generateUniqueSlug(name, async (candidate) => {
    if (isReservedSlug(candidate)) return true;
    return isSlugTaken(candidate, owner?.tenantId);
  });

  return NextResponse.json({ slug });
}
