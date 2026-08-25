"use client";

import version from "@changelog/version.json";
import { useI18n, useLocale } from "@/components/i18n-provider";

// Версия приложения мелкой строкой внизу Настроек, со ссылкой на публичную
// историю изменений (changelog/README.md). Только у Владельца: оператору версия
// не нужна, а место на экране PWA дорогое.
//
// Номер берётся из changelog/version.json — отдельного файла с ОДНИМ полем,
// который пишет тот же сборщик. Импортировать сюда releases.json нельзя: это
// клиентский компонент, и вся история уехала бы в бандл браузера ради одной
// строки.
//
// Ссылка открывается в новой вкладке: уход в документ не должен закрывать
// кабинет, в котором человек работает. Язык передаём параметром — страница
// публичная, сессии у неё нет и cookie кабинета она не читает.
export function AppVersionLine() {
  const t = useI18n();
  const locale = useLocale();

  return (
    <p className="text-caption-airbnb text-center tabular-nums">
      RentOS {version.version} ·{" "}
      <a
        href={`/changelog?lang=${locale}`}
        target="_blank"
        rel="noopener"
        className="underline underline-offset-2"
      >
        {t.changelog.title}
      </a>
    </p>
  );
}
