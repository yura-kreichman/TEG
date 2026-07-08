import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { getThemeModeCookie } from "@/lib/theme-mode";

// Per docs/spec/03-design-system.md (updated 2026-07-06): theme is a
// tenant-wide default set only by the Owner (src/lib/theme-mode.ts), applied
// here as next-themes' `defaultTheme` — same tenant setting the owner cabinet
// uses, via a separate storageKey so this side's local override doesn't fight
// with the owner cabinet's. Each Operator can still flip light/dark for their
// own device via the toggle below; that's a local override (next-themes
// localStorage) that never changes the tenant's default for anyone else.
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const themeMode = await getThemeModeCookie();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={themeMode}
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
