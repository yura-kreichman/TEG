import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import InstallAppBanner from "./install-app-banner";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { getAccentCookie } from "@/lib/accent";
import { getDictionary, resolveLocale } from "@/lib/i18n";

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
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RentOS",
  },
};

export const viewport: Viewport = {
  themeColor: "#18181b",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const accent = await getAccentCookie();
  const locale = await resolveLocale();
  const dict = getDictionary(locale);

  return (
    <html
      lang={locale}
      data-accent={accent}
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider dict={dict}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            storageKey="teg-theme-owner"
          >
            <InstallAppBanner />
            {children}
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
