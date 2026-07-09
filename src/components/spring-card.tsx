"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const cardSpring = { type: "spring" as const, stiffness: 340, damping: 32 };

/**
 * Shared card shell per docs/design/prototype-owner-v2.html: spring entrance/
 * lift, thin border-border AND shadow-card-rest together (supersedes the
 * earlier shadow-only, "almost borderless" treatment) -> shadow-card-hover on
 * hover. The lift (translateY) is framer-motion spring physics; the shadow
 * swap rides a plain Tailwind `transition-shadow` because CSS custom
 * properties (var(--shadow-card-hover)) can't be interpolated as a box-shadow
 * *value* by framer-motion's animate/whileHover — only the underlying CSS
 * transition can cross-fade between two var()-resolved values.
 */
export function SpringCard({
  children,
  className,
  hover = true,
  animate = true,
  onClick,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  /** Set false inside a StaggerItem — the parent already drives the entrance, so a second
   * independent fade/translate here would double up instead of composing with it. */
  animate?: boolean;
  onClick?: () => void;
  /** Escape hatch for a per-instance tint (e.g. an entity's own colorTag at low
   * opacity) that can't be expressed as a Tailwind class — layers under `bg-card`. */
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 8 } : undefined}
      animate={animate ? { opacity: 1, y: 0 } : undefined}
      transition={cardSpring}
      whileHover={hover ? { y: -3 } : undefined}
      onClick={onClick}
      style={style}
      className={cn(
        "w-full rounded-card border border-border bg-card p-4.5 shadow-card-rest transition-shadow duration-200",
        hover && "hover:shadow-card-hover",
        className
      )}
    >
      {children}
    </motion.div>
  );
}
