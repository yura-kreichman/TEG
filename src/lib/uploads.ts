import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

// Uploaded images (asset photos, operator avatars) are saved to local disk under
// public/uploads/<tenantId>/, scoped per tenant — not an arbitrary external URL
// (docs/spec, gap flagged by user 2026-07-06). Fine for the current
// self-hosted/dedicated-server deployment plan; would need swapping for object
// storage if this ever moves to a horizontally-scaled multi-instance deploy.
export const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function saveUploadedImage(tenantId: string, file: File): Promise<string> {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    throw new Error("Недопустимый тип файла (разрешены JPEG, PNG, WEBP)");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Файл слишком большой (максимум 5 МБ)");
  }

  // file.type — это то, что браузер САМ подставил в multipart-запрос, ничем
  // не подтверждено содержимым (вопрос пользователя 2026-07-24: JPG может
  // нести вредоносный код). До этого места код доверял ему вслепую и писал
  // байты на диск как есть — под видом .jpg могло уйти на диск что угодно.
  // Прогон через sharp — та же защита, что уже стоит в saveRemoteImageAsWebp
  // ниже: sharp реально декодирует пиксели и перекодирует заново, поэтому
  // (а) не-картинка гарантированно упадёт здесь с ошибкой, (б) любой
  // полиглот/встроенная нагрузка не переживёт передекодирование — на диск
  // попадают только заново собранные из пикселей байты, не исходные.
  let buffer: Buffer;
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()));
    buffer =
      ext === "jpg"
        ? await image.jpeg().toBuffer()
        : ext === "png"
          ? await image.png().toBuffer()
          : await image.webp().toBuffer();
  } catch {
    throw new Error("Файл повреждён или не является изображением");
  }

  const filename = `${randomUUID()}.${ext}`;
  const tenantDir = path.join(UPLOADS_ROOT, tenantId);
  await mkdir(tenantDir, { recursive: true });

  await writeFile(path.join(tenantDir, filename), buffer);

  return `/uploads/${tenantId}/${filename}`;
}

/**
 * Сохраняет изображение, скачанное СЕРВЕРОМ (не форма владельца) — сейчас
 * только обложка YouTube-видео (docs/spec/08-landing.md, "Секция видео").
 * В отличие от saveUploadedImage — всегда перекодирует в WebP через sharp
 * (докс требует WebP на выходе независимо от формата источника; обложки
 * YouTube приходят JPEG). Тот же UPLOADS_ROOT/структура путей, что у обычных
 * загрузок — deleteUploadedImage одинаково работает для обоих.
 */
export async function saveRemoteImageAsWebp(tenantId: string, buffer: Buffer): Promise<string> {
  const webp = await sharp(buffer).webp({ quality: 82 }).toBuffer();

  const filename = `${randomUUID()}.webp`;
  const tenantDir = path.join(UPLOADS_ROOT, tenantId);
  await mkdir(tenantDir, { recursive: true });
  await writeFile(path.join(tenantDir, filename), webp);

  return `/uploads/${tenantId}/${filename}`;
}

/**
 * Проверяет, что относительный URL загруженного файла действительно лежит в
 * папке ЭТОГО тенанта (`/uploads/<tenantId>/...`) — защита от того, чтобы
 * Owner одного тенанта не смог указать чужой (но легитимный) `/uploads/...`
 * URL в поле photoUrl/avatarUrl/logoUrl (аудит 2026-07-27, найдено рядом с
 * критичной дырой в deleteUploadedImage — тот же класс "клиентской строке
 * доверяли без проверки", просто здесь риск ниже: не удаление, а просто
 * "подсмотреть"/сослаться на чужую картинку). Используется на каждой записи
 * этих полей, единообразно с tenant/landing/gallery/route.ts, которая уже
 * делала эту проверку.
 */
export function isOwnUploadUrl(tenantId: string, url: string): boolean {
  return url.startsWith(`/uploads/${tenantId}/`);
}

/**
 * Best-effort cleanup when a photo/avatar is replaced or its owning record deleted.
 *
 * path.resolve + префикс-проверка (аудит 2026-07-27, реальная критичная дыра) —
 * раньше здесь был только `path.join(process.cwd(), "public", relativeUrl)` без
 * какой-либо проверки результата: `path.join` НЕ блокирует "../" сегменты, он
 * их нормализует, поэтому `relativeUrl = "/uploads/../../../../.env"` (или
 * глубже) давал путь ЗА пределами public/uploads — вплоть за пределы всего
 * проекта. `/api/abonement-wallets/broadcast` передавал сюда `imageUrl` прямо
 * из тела запроса клиента без единой проверки (см. её собственный фикс рядом),
 * то есть это было не только теоретической дырой в примитиве, а реально
 * достижимым arbitrary-file-delete для любого авторизованного Owner. Теперь
 * итоговый путь обязан лежать строго внутри UPLOADS_ROOT — резолвим и
 * сверяем префикс, независимо от того, что содержит сама строка.
 */
export async function deleteUploadedImage(relativeUrl: string | null | undefined) {
  if (!relativeUrl || !relativeUrl.startsWith("/uploads/")) return;
  const filePath = path.resolve(process.cwd(), "public", `.${relativeUrl}`);
  const resolvedRoot = path.resolve(UPLOADS_ROOT);
  if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) return;
  await unlink(filePath).catch(() => {});
}
