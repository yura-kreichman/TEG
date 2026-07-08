// Owners can pick multi-megabyte camera photos for asset/logo/avatar images;
// this downscales + re-encodes them client-side before upload so the server
// and DB never see the original file size. PNG/WebP keep their format
// (quality param is ignored for PNG — canvas.toBlob still benefits from the
// dimension downscale); everything else is re-encoded as JPEG.
export async function compressImageFile(
  file: File,
  { maxDimension = 1280, maxBytes = 250 * 1024 }: { maxDimension?: number; maxBytes?: number } = {}
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mimeType = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
  const supportsQuality = mimeType !== "image/png";

  let quality = 0.85;
  let blob = await toBlob(canvas, mimeType, quality);
  while (supportsQuality && blob && blob.size > maxBytes && quality > 0.35) {
    quality -= 0.15;
    blob = await toBlob(canvas, mimeType, quality);
  }
  if (!blob || blob.size >= file.size) return file;

  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return new File([blob], replaceExtension(file.name, ext), { type: mimeType });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function replaceExtension(name: string, ext: string) {
  return `${name.replace(/\.[^./\\]+$/, "")}.${ext}`;
}
