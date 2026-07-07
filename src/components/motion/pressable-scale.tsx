"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

/**
 * Press feedback wrapper per docs/spec/03-design-system.md ("Визуальный язык" →
 * Анимация): scale(0.96) on press, spring release — never a linear CSS transition.
 * Wrap any clickable block (card, list row) that isn't already a shadcn Button
 * (which gets its own press state via the design tokens directly).
 */
export function PressableScale({ children, className, ...props }: HTMLMotionProps<"div">) {
  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
