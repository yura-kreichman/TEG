"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Soft shimmer loading placeholder per docs/spec/03-design-system.md — a moving
 * gradient sweep, not a full-screen spinner and not Tailwind's default
 * fade-in/out `animate-pulse` (spec explicitly calls for "мягкое мерцание").
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-control bg-muted", className)} aria-hidden>
      <motion.div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
        animate={{ translateX: ["-100%", "100%"] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}
