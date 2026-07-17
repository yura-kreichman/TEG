import type { Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeColorMeta } from "@/components/theme-color-meta";
import { OperatorSwitchButton } from "@/components/operator-switch-button";
import { OperatorBottomNav } from "@/components/operator-bottom-nav";
import { OfflineSync } from "./offline-sync";

// Переопределяет статический fallback из корневого layout.tsx (#ffffff,
// подходит владельцу) — у оператора дефолт тёмный, а не светлый.
export const viewport: Viewport = {
  themeColor: "#141917",
};

// Тема — только локальная настройка устройства (next-themes localStorage,
// storageKey отдельный от кабинета владельца), никакого тенантного дефолта
// владелец не назначает — каждый оператор переключает светлую/тёмную сам на
// своём устройстве, независимо от других (см. фидбек пользователя
// 2026-07-09). PWA оператора по умолчанию тёмная (docs/spec/03-design-system.md),
// это просто стартовое значение для устройства, где ещё ничего не выбирали.
export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="teg-theme-operator"
    >
      <div className="flex flex-1 flex-col">
        <ThemeColorMeta />
        <OfflineSync />
        <div className="flex items-center justify-between gap-2 p-2">
          <OperatorSwitchButton />
          <ThemeToggle />
        </div>
        <OperatorBottomNav>{children}</OperatorBottomNav>
      </div>
    </ThemeProvider>
  );
}
