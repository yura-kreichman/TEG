import { Inter } from "next/font/google";
import "../../../globals.css";
import "./landing.css";
import "@/components/landing/landing-themes.css";
import { prisma } from "@/lib/prisma";

// Корневой layout ТОЛЬКО для /site/** (docs/spec/08-landing.md, Шаг 4) —
// намеренно НЕ использует общий src/app/(app)/layout.tsx: тот читает cookies
// (акцент/локаль владельца) в каждом рендере, что принудительно делает весь
// поддерево динамическим в Next.js — здесь же нужен настоящий SSG/ISR
// (решение пользователя 2026-07-13). Живёт на уровне [slug], а не в
// (site)/layout.tsx — так он получает params.slug и может выставить
// <html lang> в ЯЗЫК ТЕНАНТА (докс), а не языка/сессии посетителя. Никакого
// InstallAppBanner/DisableContextMenu/I18nProvider с полным словарём (58КБ
// JSON) — это чужая, ненужная нагрузка на бюджет JS публичной страницы.
//
// Веса — объединение того, что уже требовалось (400 тело, 600/700 текущие
// заголовки секций) и того, что требуют 6 тем лендинга (докс, "Темы
// лендинга", решение 2026-07-13: Inter, не Noto — платформенный шрифт
// везде): 300 Неон, 800 Ретро/Пиксельный, 900 Фестиваль. 800 заодно чинит
// скрытый пробел — h1 уже рендерился font-extrabold (800), которого не было
// в списке весов, браузер синтезировал жирность из 700. 500 убран — по
// коду публичной страницы не используется нигде (font-medium не встречается
// в src/app/(site)/site/[slug] и src/components/landing), докс требует
// грузить только реально нужные веса. Курсив Классика — синтетический (CSS
// font-style: italic поверх обычного начертания), не отдельный italic-файл:
// используется только в одном месте одной темы, отдельный next/font-вызов
// ради этого не оправдан бюджетом.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "600", "700", "800", "900"],
});

export default async function LandingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { locale: true, accentScheme: true, landing: { select: { theme: true } } },
  });

  return (
    <html
      lang={tenant?.locale ?? "ru"}
      data-accent={tenant?.accentScheme ?? "green"}
      data-landing-theme={tenant?.landing?.theme ?? "modern"}
      className={`${inter.variable} h-full overflow-x-hidden antialiased`}
    >
      {/* overflow-x на body одном не всегда подхватывается как корневой
          скроллер мобильными браузерами (репорт: остаточный горизонтальный
          скролл в Opera Mobile из-за full-bleed .lt-h2-bar на 100vw, хотя в
          Chrome тот же .lt-page{overflow-x:hidden} уже чинил это, докс
          2026-07-13) — html и body должны резать overflow оба. */}
      <body className="lt-page min-h-full overflow-x-hidden">{children}</body>
    </html>
  );
}
