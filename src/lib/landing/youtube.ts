// Парсер ссылок YouTube (docs/spec/08-landing.md, "Секция видео") — владелец
// может вставить ссылку в любой из 4 форм, ID извлекается сервером. YouTube
// video ID — всегда 11 символов [A-Za-z0-9_-] (устойчивый факт формата
// платформы, не эвристика).
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

const PATTERNS: RegExp[] = [
  // https://www.youtube.com/watch?v=ID (+ любые доп. query-параметры)
  /(?:youtube\.com)\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
  // https://youtu.be/ID
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  // https://www.youtube.com/shorts/ID
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  // https://www.youtube.com/embed/ID
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
];

/** Возвращает 11-символьный YouTube video ID или null, если ссылка не распознана. */
export function parseYoutubeId(input: string): string | null {
  const v = input.trim();
  if (!v) return null;

  // Голый ID без ссылки — тоже принимаем (владелец мог вставить только его).
  if (ID_RE.test(v)) return v;

  // Остальное — только http(s)-ссылки; ftp:// и прочие схемы отклоняем
  // явно, а не полагаемся на то, что домен просто не совпадёт.
  if (!/^https?:\/\//i.test(v)) return null;

  for (const re of PATTERNS) {
    const m = v.match(re);
    if (m && ID_RE.test(m[1])) return m[1];
  }

  return null;
}

const THUMBNAIL_VARIANTS = ["maxresdefault", "hqdefault"] as const;

/**
 * Скачивает обложку ролика с img.youtube.com — сначала maxresdefault (HD,
 * есть не у всех роликов — старые/низкого разрешения ролики его не отдают),
 * с фолбэком на hqdefault (есть всегда для существующего видео). 404 на ОБА
 * варианта означает несуществующий ID — так сервер валидирует ролик без
 * обращения к YouTube Data API (докс: "этим валидирует существование
 * ролика"). Проверено вживую на реальных ID (не по памяти): несуществующий
 * ID отдаёт честный HTTP 404 на оба варианта, никакой заглушки-обманки.
 */
export async function fetchYoutubeThumbnail(videoId: string): Promise<Buffer | null> {
  for (const variant of THUMBNAIL_VARIANTS) {
    const res = await fetch(`https://img.youtube.com/vi/${videoId}/${variant}.jpg`);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}
