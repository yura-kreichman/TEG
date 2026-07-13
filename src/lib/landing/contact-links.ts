// Построение ссылок для контактов Лендинга (docs/spec/08-landing.md,
// "Контакты") из свободно введённых владельцем строк — best-effort: если
// значение уже похоже на полный URL, используем как есть, иначе строим
// стандартную ссылку платформы.
export type ContactKind =
  | "phone"
  | "telegram"
  | "viber"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "vk"
  | "ok"
  | "youtube";

export function contactHref(kind: ContactKind, value: string): string {
  const v = value.trim();
  if (kind === "phone") return `tel:${v.replace(/[^\d+]/g, "")}`;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "telegram":
      return `https://t.me/${handle}`;
    case "viber":
      return `viber://chat?number=${encodeURIComponent(v.replace(/[^\d+]/g, ""))}`;
    case "whatsapp":
      return `https://wa.me/${v.replace(/[^\d]/g, "")}`;
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "facebook":
      return `https://facebook.com/${handle}`;
    case "tiktok":
      return `https://tiktok.com/@${handle}`;
    case "vk":
      return `https://vk.com/${handle}`;
    case "ok":
      return `https://ok.ru/${handle}`;
    case "youtube":
      return `https://youtube.com/@${handle}`;
  }
}
