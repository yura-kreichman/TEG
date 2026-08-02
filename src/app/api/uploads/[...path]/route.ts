import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { UPLOADS_ROOT } from "@/lib/uploads";

// Отдаёт загруженный файл с диска ПО ЗАПРОСУ, а не из статического списка
// public/, который Next.js снимает один раз при старте процесса.
//
// Зачем это вообще нужно (реальный баг на проде 2026-08-02, тенант «Керен
// Центр»): фото, загруженные ПОСЛЕ старта контейнера, физически лежали в
// public/uploads/<tenantId>/, отдавались браузеру nginx-алиасом (см.
// deploy/nginx/my.rentos365.app.conf) — и всё равно были битыми в вёрстке.
// Потому что <Image> рендерит не сам путь, а /_next/image?url=/uploads/...,
// а оптимизатор картинок за исходником ходит ВНУТРЬ себя, по своему же
// http://127.0.0.1:3000 — минуя nginx. Там срабатывает то самое ограничение
// public/: файла нет в снятом при старте списке → внутренние 404 → оптимизатор
// отдаёт 400 → битая картинка. Проверено на сервере: файл от 31 июля (до
// старта контейнера) отдавался, все от 2 августа — 404 изнутри контейнера при
// том, что `ls` внутри контейнера их видит.
//
// Роут подключён afterFiles-рерайтом /uploads/:path* (next.config.ts), то есть
// срабатывает ТОЛЬКО когда статика не нашлась: старые файлы по-прежнему уходят
// быстрым статическим путём, новые — сюда. Отдельным плюсом приложение
// перестаёт зависеть от nginx-алиаса: /uploads/* теперь работает и без него.
//
// Без авторизации — ровно как nginx-алиас и /api/icon-library/* сегодня:
// эти файлы уже публичны по своей природе (Лендинг и Инструктажи — публичные
// страницы без входа), никакого нового доступа роут не открывает.

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_request: Request, ctx: RouteContext<"/api/uploads/[...path]">) {
  const { path: segments } = await ctx.params;

  const ext = path.extname(segments.at(-1) ?? "").toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  // Тот же принцип, что в deleteUploadedImage (см. lib/uploads.ts): path.join
  // не блокирует "../", а нормализует их, поэтому проверяем не саму строку, а
  // итоговый путь — он обязан лежать строго внутри UPLOADS_ROOT.
  const filePath = path.resolve(UPLOADS_ROOT, ...segments);
  const root = path.resolve(UPLOADS_ROOT);
  if (!filePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  let file: Buffer;
  try {
    file = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": contentType,
      // Имя файла — случайный UUID (saveUploadedImage), существующий файл
      // никогда не перезаписывается новым содержимым: замена фото создаёт
      // новый URL, а старый удаляется. Значит immutable здесь безопасен.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
