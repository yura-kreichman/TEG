"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, Home, ListChecks, MapPin, MoreHorizontal, Settings, Users, Wallet } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/components/i18n-provider";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { cn } from "@/lib/utils";

/**
 * Owner cabinet shell per docs/spec/03-design-system.md: sidebar on desktop,
 * bottom nav on mobile, "максимум 5 вкладок + «Ещё»" — added with the Tasks
 * module (2026-07-09): Settings moved out of the 5 direct tabs into the
 * "Ещё" overflow sheet (mobile) / extra sidebar links (desktop, no width
 * constraint there so no need for the sheet), Tasks took its old slot,
 * Reports is a new stub entry point alongside Settings in the overflow.
 */
export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  const NAV_ITEMS = [
    { href: "/", label: t.nav.home, icon: Home, match: (p: string) => p === "/" },
    { href: "/points", label: t.nav.points, icon: MapPin, match: (p: string) => p === "/points" },
    { href: "/operators", label: t.nav.operators, icon: Users, match: (p: string) => p === "/operators" },
    { href: "/money", label: t.nav.money, icon: Wallet, match: (p: string) => p === "/money" },
    { href: "/tasks", label: t.nav.tasks, icon: ListChecks, match: (p: string) => p.startsWith("/tasks") },
  ];

  const MORE_ITEMS = [
    { href: "/reports", label: t.nav.reports, icon: BarChart3 },
    { href: "/settings", label: t.nav.settings, icon: Settings },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="hidden shrink-0 flex-col justify-between bg-surface-0 p-4 md:flex md:w-56">
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
          <div className="my-1 border-t border-border" />
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
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
        <ThemeToggle />
      </aside>

      <div className="flex flex-1 flex-col pb-16 md:pb-0">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 flex bg-card shadow-floating md:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          return (
            <PressableScale key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-xs font-medium",
                  active ? "text-primary" : "text-sidebar-foreground"
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            </PressableScale>
          );
        })}
        <PressableScale className="flex-1">
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex w-full flex-col items-center gap-0.5 py-2 text-xs font-medium",
              MORE_ITEMS.some((item) => pathname === item.href) ? "text-primary" : "text-sidebar-foreground"
            )}
          >
            <MoreHorizontal className="size-5" />
            {t.nav.more}
          </button>
        </PressableScale>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <div className="flex flex-col pt-2">
          <h2 className="mb-2 text-[19px] font-extrabold tracking-[-0.01em]">{t.nav.more}</h2>
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 border-t border-border py-3.5 text-left text-body-airbnb first:border-t-0"
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}
