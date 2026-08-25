import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../../globals.css";

// Корневой layout ТОЛЬКО для /changelog (changelog/README.md). Как и у
// лендинга, намеренно не используется общий (app)/layout.tsx: тот читает
// cookies кабинета, тянет полный словарь в клиент, ставит баннер установки
// PWA и наблюдатель версии — всё это чужое для страницы, которую открывают
// по ссылке из подвала сайта.
//
// Тема — только светлая: класс .dark сюда никто не ставит, и это осознанно.
// Вложенный next-themes-провайдер уже один раз оказался пустышкой и покрасил
// не то, что нужно (правка 2026-08-23); документу переключатель темы не нужен.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  // Приложение целиком закрыто от индексации (src/app/robots.ts), поэтому и
  // здесь явный noindex — страница служебная, витрина живёт на rentos365.app.
  robots: { index: false, follow: false },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
