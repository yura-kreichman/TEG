"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MapPin, Settings, Users, Wallet } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/components/i18n-provider";
import { PressableScale } from "@/components/motion/pressable-scale";
import { cn } from "@/lib/utils";

/**
 * Owner cabinet shell per docs/spec/03-design-system.md: sidebar on desktop,
 * bottom nav on mobile. Nav item list is short and static for now — once more
 * owner-facing modules exist (money, reports) it grows from the same array.
 * Restyled per "Визуальный язык": chrome recedes (surface-0, no heavy border),
 * active state is a soft accent-tinted pill rather than a solid block, press
 * feedback is a framer-motion spring scale.
 */
export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useI18n();

  const NAV_ITEMS = [
    { href: "/", label: t.nav.home, icon: Home },
    { href: "/points", label: t.nav.points, icon: MapPin },
    { href: "/operators", label: t.nav.operators, icon: Users },
    { href: "/money", label: t.nav.money, icon: Wallet },
    { href: "/settings", label: t.nav.settings, icon: Settings },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="hidden shrink-0 flex-col justify-between bg-surface-0 p-4 md:flex md:w-56">
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
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
          const active = pathname === item.href;
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
      </nav>
    </div>
  );
}
