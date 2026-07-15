"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/components/i18n-provider";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useI18n();
  const [mounted, setMounted] = useState(false);

  // Theme is only known after hydration (it comes from localStorage) — render
  // nothing meaningful until then to avoid a light/dark flash mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div aria-hidden className="h-7 w-24 opacity-0" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <div className="flex items-center gap-2">
      <Sun className={isDark ? "size-4 text-muted-foreground" : "size-4 text-primary"} />
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label={isDark ? t.theme.toggleToLight : t.theme.toggleToDark}
      />
      <Moon className={isDark ? "size-4 text-primary" : "size-4 text-muted-foreground"} />
    </div>
  );
}
