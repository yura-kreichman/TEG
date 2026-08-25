import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n";
import {
  CHANGE_TYPE_ORDER,
  currentVersion,
  entryText,
  localeFromParam,
  releases,
  type ChangeType,
} from "@/lib/changelog";

// Публичная история изменений (changelog/README.md). Открывается по ссылке из
// подвала rentos365.app, поэтому язык приходит параметром ?lang= — сессии и
// cookie кабинета тут нет и читать их нельзя.
//
// Дат нет нигде и быть не должно (решение владельца 2026-08-25): только номер
// версии и что в ней изменилось. Шрифт по всей странице мелкий — это документ,
// который просматривают, а не экран, на котором работают.

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const TYPE_LABEL: Record<ChangeType, "typeFeat" | "typeImpr" | "typeFix"> = {
  feat: "typeFeat",
  impr: "typeImpr",
  fix: "typeFix",
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const d = getDictionary(localeFromParam((await searchParams).lang));
  return { title: `${d.changelog.title} — RentOS` };
}

export default async function ChangelogPage({ searchParams }: { searchParams: Search }) {
  const locale = localeFromParam((await searchParams).lang);
  const d = getDictionary(locale).changelog;

  return (
    // lang на <main>, а не на <html>: разметку документа ставит layout, который
    // о параметре запроса ничего не знает, а язык содержимого знать надо —
    // иначе браузер и скринридер читают английский текст по русским правилам.
    <main lang={locale} className="mx-auto w-full max-w-[40rem] px-5 py-10 sm:py-14">
      <header className="border-b border-border pb-5">
        <h1 className="text-[0.9375rem] font-bold leading-snug tracking-[-0.01em]">{d.title}</h1>
        <p className="text-caption-airbnb mt-1">{d.subtitle}</p>
        <p className="text-caption-airbnb mt-4 tabular-nums">
          {d.version} {currentVersion}
        </p>
      </header>

      <ol className="mt-8 space-y-8">
        {releases.map((release) => (
          <li key={release.version}>
            <h2 className="text-[0.8125rem] font-bold tabular-nums tracking-[-0.01em]">
              {release.version}
            </h2>

            <div className="mt-2.5 space-y-3">
              {CHANGE_TYPE_ORDER.map((type) => {
                const entries = release.entries.filter((e) => e.type === type);
                if (!entries.length) return null;

                return (
                  <section key={type}>
                    <h3 className="text-section-title">{d[TYPE_LABEL[type]]}</h3>
                    <ul className="mt-1.5 space-y-1.5">
                      {entries.map((entry, i) => (
                        <li
                          key={i}
                          className="text-[0.8125rem] leading-relaxed text-muted-foreground"
                        >
                          {entryText(entry, locale)}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
