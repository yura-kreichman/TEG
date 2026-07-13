import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

// Uploaded images (asset photos, operator avatars) are saved to local disk under
// public/uploads/<tenantId>/, scoped per tenant — not an arbitrary external URL
// (docs/spec, gap flagged by user 2026-07-06). Fine for the current
// self-hosted/dedicated-server deployment plan; would need swapping for object
// storage if this ever moves to a horizontally-scaled multi-instance deploy.
const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");
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

  const filename = `${randomUUID()}.${ext}`;
  const tenantDir = path.join(UPLOADS_ROOT, tenantId);
  await mkdir(tenantDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
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

/** Best-effort cleanup when a photo/avatar is replaced or its owning record deleted. */
export async function deleteUploadedImage(relativeUrl: string | null | undefined) {
  if (!relativeUrl || !relativeUrl.startsWith("/uploads/")) return;
  const filePath = path.join(process.cwd(), "public", relativeUrl);
  await unlink(filePath).catch(() => {});
}
