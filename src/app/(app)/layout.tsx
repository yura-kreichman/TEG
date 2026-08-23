import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import InstallAppBanner from "./install-app-banner";
import { AppThemeProvider } from "@/components/app-theme-provider";
import { ThemeColorMeta } from "@/components/theme-color-meta";
import { DisableContextMenu } from "@/components/disable-context-menu";
import { VersionWatcher } from "@/components/version-watcher";
import { I18nProvider } from "@/components/i18n-provider";
import { TextScaleProvider } from "@/components/text-scale-provider";
import { getAccentCookie } from "@/lib/accent";
import { getBgStyleCookie } from "@/lib/bg-style";
import { AppBackground } from "@/components/app-background";
import { NavProgressBar } from "@/components/nav-progress-bar";
import { SaveSuccessOverlay } from "@/components/ui/save-success-overlay";
import { DeleteSuccessOverlay } from "@/components/ui/delete-success-overlay";
import { getDictionary, resolveLocale } from "@/lib/i18n";
import { resolveTenantCurrency } from "@/lib/currency-resolve";
import { getNonce } from "@/lib/nonce";

// Per docs/design/prototype-owner-v2.html (approved 2026-07-07, supersedes the
// prior Onest choice from the Airbnb-referenced pass): Inter with full Cyrillic
// — weights 400/500/600/700/800 for body through page-title (800).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RentOS",
  description: "RentOS SaaS",
  applicationName: "RentOS",
  icons: {
    icon: [
      { url: "/icon-library/pwa/favicon-pack/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-library/pwa/favicon-pack/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-library/pwa/favicon-pack/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-library/pwa/favicon-pack/favicon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/icon-library/pwa/favicon-pack/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-library/pwa/favicon-pack/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RentOS",
  },
  // apple-touch-fullscreen — доп. iOS-тег полноэкранного режима, взят из
  // сравнения с Progressify (Progressify/.../views/meta-tags.php). Не
  // добавляем сюда mobile-web-app-capable — Next.js уже генерирует его сам
  // из appleWebApp.capable (node_modules/next/dist/lib/metadata/metadata.js),
  // ручное дублирование даёт два одинаковых <meta> тега.
  other: {
    "apple-touch-fullscreen": "yes",
  },
};

// Статический fallback до гидратации/ThemeColorMeta — совпадает с реальным
// дефолтом кабинета владельца (defaultTheme="light" в ThemeProvider ниже,
// без enableSystem, так что это не про prefers-color-scheme ОС). Раньше тут
// был #18181b (тёмный) для всех — мимо для дефолтного светлого владельца,
// системная область под .nav-glass-баром красилась в несочетающийся тёмный
// без блюра (фидбек 2026-07-12). Оператор переопределяет своим значением
// в operator/layout.tsx (у него свой дефолт — тёмный).
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const accent = await getAccentCookie();
  const bgStyle = await getBgStyleCookie();
  const locale = await resolveLocale();
  const dict = getDictionary(locale);
  const currency = await resolveTenantCurrency();
  const nonce = await getNonce();

  return (
    <html
      lang={locale}
      data-accent={accent}
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppBackground style={bgStyle} />
        <DisableContextMenu />
        {/* Перезагрузка при появлении новой сборки (запрос владельца
            2026-08-13). В общем layout, а не в PWA Сотрудника: кабинет
            владельца тоже держат открытым подолгу, и устаревшая вкладка там
            ломается ровно так же. */}
        <VersionWatcher version={process.env.NEXT_DEPLOYMENT_ID ?? null} />
        <I18nProvider dict={dict} locale={locale} currency={currency}>
          {/* Тема выбирается по разделу (AppThemeProvider): кабинет/вход/
              админка — светлая, PWA Сотрудника — тёмная. Провайдер тут
              ОДИН на всё приложение: вложенный next-themes-провайдер молча
              не работает, см. комментарий в app-theme-provider.tsx. */}
          {/* nonce обязателен (аудит 2026-08-13): next-themes вставляет
              ИНЛАЙНОВЫЙ скрипт, который выставляет класс темы до первой
              отрисовки, а после замены 'unsafe-inline' на nonce в script-src
              браузер выполнит инлайновый скрипт только с действующим nonce.
              Без него скрипт молча блокируется — тема применяется уже после
              гидратации, то есть возвращается ровно то мигание светлым, ради
              устранения которого этот скрипт и существует. */}
          <AppThemeProvider nonce={nonce}>
            <ThemeColorMeta />
            <NavProgressBar />
            <InstallAppBanner />
            <SaveSuccessOverlay />
            <DeleteSuccessOverlay />
            <TextScaleProvider>{children}</TextScaleProvider>
          </AppThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
