import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

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
        <div className="flex justify-end p-2">
          <ThemeToggle />
        </div>
        {children}
      </div>
    </ThemeProvider>
  );
}
