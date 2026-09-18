import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { extractPlainText } from "@/lib/rich-text";

// Предел описания страницы (docs/spec/08-landing.md, «Мета»: обрезка
// ~160 симв.) — длиннее поисковик всё равно обрежет в сниппете сам.
const MAX_DESCRIPTION = 160;

// Короче этого конец предложения не берём: описание из одной фразы в
// 40 символов хуже, чем почти полный текст с многоточием на границе слова.
const MIN_SENTENCE_CUT = 100;

/**
 * Описание страницы — одно и то же в <meta name="description">, OpenGraph и
 * JSON-LD, чтобы сниппет и разметка не расходились формулировками.
 *
 * До 2026-09-18 текст резался ровно на 160-м символе, и у Керен Центра
 * сниппет кончался на «…уютные праздники. Играем,». Теперь режем по концу
 * последнего предложения, влезающего в предел, а если такого нет — по
 * последнему целому слову с многоточием.
 */
export function landingDescription(data: Pick<LandingRenderData, "metaDescriptionOverride" | "aboutText">): string {
  const text = (data.metaDescriptionOverride ?? extractPlainText(data.aboutText)).replace(/\s+/g, " ").trim();
  if (text.length <= MAX_DESCRIPTION) return text;

  const head = text.slice(0, MAX_DESCRIPTION);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("… "));
  if (sentenceEnd + 1 >= MIN_SENTENCE_CUT) return head.slice(0, sentenceEnd + 1);

  // Место под «…» оставляем внутри предела, а хвостовую пунктуацию и тире
  // срезаем — «праздники, …» читается как обрыв, а не как сокращение.
  const wordEnd = head.lastIndexOf(" ");
  const cut = wordEnd > 0 ? head.slice(0, wordEnd) : head.slice(0, MAX_DESCRIPTION - 1);
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}
