import type { Viewport } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeColorMeta } from "@/components/theme-color-meta";
import { OperatorSwitchButton } from "@/components/operator-switch-button";
import { OwnerLoginToggle } from "@/components/owner-login-toggle";
import { OperatorBottomNav } from "@/components/operator-bottom-nav";
import { OperatorBrandingChrome } from "@/components/operator-branding-chrome";
import { TicketsCartProvider, GoodsCartProvider } from "@/components/operator-cart-context";
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
// 2026-07-09). PWA оператора по умолчанию тёмная (docs/spec/03-design-system.md).
//
// Сам ThemeProvider здесь больше НЕ рендерится (2026-08-23): вложенный
// next-themes-провайдер — пустышка, и «тёмная по умолчанию» с отдельным
// ключом хранения тут молча не работали, а переключатель темы в PWA красил
// заодно кабинет владельца, экраны входа/регистрации и админку на этом
// устройстве. Выбор раздела переехал в src/components/app-theme-provider.tsx
// (там же полный разбор), провайдер на всё приложение теперь ровно один — в
// корневом layout.tsx, вместе со своим nonce.
export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <ThemeColorMeta />
      <OfflineSync />
      <OperatorBrandingChrome />
      <div className="flex items-center justify-between gap-2 p-2">
        <OperatorSwitchButton />
        <OwnerLoginToggle />
        <ThemeToggle />
      </div>
      {/* Корзины Билетов/Товаров — на уровне layout (запрос пользователя
          2026-07-21: "не должно сбрасываться при переключении между
          пунктами меню"), этот layout не перемонтируется между /operator/*
          страницами, в отличие от самих страниц. */}
      <TicketsCartProvider>
        <GoodsCartProvider>
          <OperatorBottomNav>{children}</OperatorBottomNav>
        </GoodsCartProvider>
      </TicketsCartProvider>
    </div>
  );
}
