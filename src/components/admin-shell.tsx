"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Building2, LogOut, Package, Settings } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/components/i18n-provider";
import { PressableScale } from "@/components/motion/pressable-scale";
import { cn } from "@/lib/utils";

// Отдельная оболочка платформенного Super Admin (docs/spec/00-architecture.md) —
// сознательно не переиспользует OwnerShell: другая сессия, другая навигация
// (тенанты/пакеты, а не точки/операторы/деньги), не должна путаться с кабинетом владельца.
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useI18n();

  const NAV_ITEMS = [
    { href: "/admin", label: t.admin.navTenants, icon: Building2, match: (p: string) => p === "/admin" || p.startsWith("/admin/tenants") },
    { href: "/admin/packages", label: t.admin.navPackages, icon: Package, match: (p: string) => p.startsWith("/admin/packages") },
    { href: "/admin/settings", label: t.admin.navSettings, icon: Settings, match: (p: string) => p.startsWith("/admin/settings") },
  ];

  async function handleLogout() {
    await fetch("/api/auth/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="hidden shrink-0 flex-col justify-between bg-surface-0 p-4 md:flex md:w-56">
        <div>
          <div className="mb-4 px-3 text-sm font-extrabold tracking-[-0.01em]">{t.admin.shellTitle}</div>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.match(pathname);
              return (
                <PressableScale key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                </PressableScale>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-col gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <LogOut className="size-4" />
            {t.common.logout}
          </button>
        </div>
      </aside>

      <nav className="flex items-center justify-between gap-2 border-b border-border bg-surface-0 px-4 py-3 md:hidden">
        <div className="text-sm font-extrabold tracking-[-0.01em]">{t.admin.shellTitle}</div>
        <div className="flex items-center gap-3">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("text-sm font-semibold", active ? "text-primary" : "text-muted-foreground")}
              >
                {item.label}
              </Link>
            );
          })}
          <button type="button" onClick={handleLogout} className="text-muted-foreground">
            <LogOut className="size-4" />
          </button>
        </div>
      </nav>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
