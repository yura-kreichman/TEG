"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { AuthLocalePicker } from "@/components/auth-locale-picker";
import { OperatorLoginToggle } from "@/components/operator-login-toggle";

const cardSpring = { type: "spring" as const, stiffness: 340, damping: 32 };

/**
 * Shared wrapper for the auth screen group (login/register/set-pin/forgot-password/
 * reset-password/activate-device, plus operator/login) per docs/spec/03-design-system.md
 * "Визуальный язык": surface-0 background, rounded-card with shadow-card-rest, spring
 * entrance. Theme-aware throughout (bg-surface-0/bg-card resolve per next-themes) — the
 * operator side's dark-by-default look comes from its own ThemeProvider defaultTheme,
 * not from a forced color here, so the operator's personal light/dark toggle keeps working.
 *
 * Logo above the language picker and wordmark below the card are added here once so
 * every screen in the group gets them uniformly (2026-07-12 request). Wordmark comes in
 * a light-bg (navy text) and dark-bg (white text) SVG — pick by resolvedTheme, same
 * mounted-guard pattern as ThemeToggle to avoid a hydration flash of the wrong one.
 */
export function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 bg-surface-0 px-4 pb-16">
      {/* Тот же бар, что у верха PWA Сотрудника (operator/layout.tsx) —
          запрос пользователя 2026-07-29, симметрия с OwnerLoginToggle там.
          AuthCard общий на все pre-auth экраны (см. верхний комментарий),
          поэтому строка всегда в разметке — OperatorLoginToggle сам решает,
          показываться ли (только /login + устройство уже активировано как
          точка), на остальных экранах строка просто пустая. absolute, не
          обычный поток — контейнер здесь center-content (justify-center по
          вертикали), а не top-to-bottom, как у operator/layout.tsx, иначе
          бар оказался бы над логотипом внутри центрированного стека, а не
          прижатым к настоящему краю экрана. */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2">
        <OperatorLoginToggle />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-library/pwa/RentOS-icon.svg" alt="" className="size-16" />
      <AuthLocalePicker />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardSpring}
        className={cn("w-full max-w-sm rounded-card bg-card p-6 shadow-card-rest", className)}
      >
        {children}
      </motion.div>
      {mounted && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={
            resolvedTheme === "dark"
              ? "/icon-library/pwa/RentOS365-dark.svg"
              : "/icon-library/pwa/RentOS365-light.svg"
          }
          alt="RentOS365"
          className="absolute bottom-4 h-6 w-auto"
        />
      )}
    </div>
  );
}
