import type { MetadataRoute } from "next";

// Должен жить в ИСТИННОМ корне app/ (докс/spec/08-landing.md, Шаг 6) — тот
// же файловый конвеншен, что у sitemap.ts/favicon.ico/manifest.ts.
// Приложение (кабинет владельца, PWA оператора, API) не предназначено для
// индексации вообще — публична только /s/{slug} (путь перенесён с /site/
// решением пользователя 2026-07-14, старый префикс — 301 в next.config.ts),
// и то не её превью-ветка.
// force-dynamic по той же причине, что и в sitemap.ts рядом: robots.txt Next
// кэширует как статический роут и считает его во время `next build` внутри
// Docker-образа, где SITE_URL ещё не задан. Из-за этого прод три недели
// отдавал `Sitemap: http://localhost:3000/sitemap.xml` — ссылку, по которой
// поисковик карту сайта найти не может (обнаружено 2026-08-15 проверкой
// живого robots.txt после деплоя). Считать этот файл на каждый запрос дёшево:
// в нём нет ни одного обращения к базе, а заходов — единицы в сутки.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

// Сборщики, которым на приложении не нужно ничего, включая лендинги (запрос
// владельца 2026-08-15: «чтобы его ничего не дёргало»). Делятся на две
// породы, и обе одинаково бесполезны для нас:
//   — обучающие/ИИ-краулеры: качают контент в чужие модели и в выдачу не
//     приводят никого;
//   — коммерческие SEO-сканеры (Ahrefs, Semrush, Majestic и родня): ходят
//     сплошняком по всем адресам ради чужих отчётов о ссылках.
// Поисковикам, которые реально приводят посетителей на лендинг тенанта,
// правило ниже не мешает — они попадают в общее правило и видят /s/.
//
// Google-Extended и Applebot-Extended — это НЕ поисковые роботы, а отдельные
// имена для обучения моделей; запрет по ним на выдачу Google и Apple не
// влияет.
const SCRAPER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "YouBot",
  "cohere-ai",
  "AI2Bot",
  "Webzio-Extended",
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "DataForSeoBot",
  "BLEXBot",
  "SerpstatBot",
  "Barkrowler",
  "PetalBot",
  "ZoominfoBot",
  "magpie-crawler",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Правило работает по самому длинному совпадению, поэтому каждый явный
        // Allow длиннее общего `Disallow: /` и побеждает. Открыты ровно те
        // адреса, без которых лендинг для поисковика неполноценен (найдено
        // 2026-08-15, до этого был открыт только сам /s/):
        //   /sitemap.xml   — карта сайта. Заблокированную в robots.txt карту
        //                    поисковик не читает, то есть строка `Sitemap:`
        //                    внизу этого же файла звала на запрещённый адрес;
        //   /_next/static/ — стили и скрипты. Без них Googlebot рендерит
        //                    страницу без вёрстки и хуже понимает содержимое;
        //   /_next/image   — оптимизатор картинок, через него выводятся ВСЕ
        //                    изображения страницы;
        //   /uploads/      — сами файлы: на них указывают og:image и все
        //                    ImageObject в структурированных данных, а
        //                    требование Google к логотипу Organization прямо
        //                    гласит «URL должен быть доступен для сканирования»;
        //   /icon-library/, /api/icon-library/ — иконки зон и точек;
        //   /landing-share.js — единственный собственный скрипт страницы.
        // Остальное приложение (кабинет, PWA, API) закрыто как и было.
        allow: [
          "/s/",
          "/sitemap.xml",
          "/_next/static/",
          "/_next/image",
          "/uploads/",
          "/icon-library/",
          "/api/icon-library/",
          "/landing-share.js",
        ],
        disallow: ["/", "/s/*/preview/"],
      },
      {
        userAgent: SCRAPER_AGENTS,
        disallow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
