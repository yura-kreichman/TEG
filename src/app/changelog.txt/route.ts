import { getDictionary } from "@/lib/i18n";
import {
  CHANGE_TYPE_ORDER,
  currentVersion,
  entryText,
  localeFromParam,
  releases,
  type ChangeType,
} from "@/lib/changelog";

// Та же история изменений обычным текстом: /changelog.txt (changelog/README.md).
// Стоит ровно ничего — данные и правила те же, что у страницы, отличается
// только вывод, — а пригождается там, где оформление мешает: посмотреть
// быстро, скопировать целиком, отдать во что-нибудь ещё.

const TYPE_LABEL: Record<ChangeType, "typeFeat" | "typeImpr" | "typeFix"> = {
  feat: "typeFeat",
  impr: "typeImpr",
  fix: "typeFix",
};

export async function GET(request: Request) {
  const locale = localeFromParam(new URL(request.url).searchParams.get("lang") ?? undefined);
  const d = getDictionary(locale).changelog;

  const lines: string[] = [`RentOS — ${d.title}`, `${d.version} ${currentVersion}`, ""];

  for (const release of releases) {
    lines.push(release.version);
    for (const type of CHANGE_TYPE_ORDER) {
      const entries = release.entries.filter((e) => e.type === type);
      if (!entries.length) continue;
      lines.push(`  ${d[TYPE_LABEL[type]]}`);
      for (const entry of entries) lines.push(`    - ${entryText(entry, locale)}`);
    }
    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Файл меняется только с деплоем, а сам деплой меняет и адрес статики,
      // поэтому час кэша безопасен и снимает нагрузку с любого опроса извне.
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
