"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const cardSpring = { type: "spring" as const, stiffness: 340, damping: 32 };

/**
 * Shared wrapper for the auth screen group (login/register/set-pin/forgot-password/
 * reset-password/activate-device, plus operator/login) per docs/spec/03-design-system.md
 * "Визуальный язык": surface-0 background, rounded-card with shadow-card-rest, spring
 * entrance. Theme-aware throughout (bg-surface-0/bg-card resolve per next-themes) — the
 * operator side's dark-by-default look comes from its own ThemeProvider defaultTheme,
 * not from a forced color here, so the operator's personal light/dark toggle keeps working.
 */
export function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface-0 px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardSpring}
        className={cn("w-full max-w-sm rounded-card bg-card p-6 shadow-card-rest", className)}
      >
        {children}
      </motion.div>
    </div>
  );
}
