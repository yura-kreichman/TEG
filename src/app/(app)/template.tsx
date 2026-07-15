"use client";

import { motion, useReducedMotion } from "framer-motion";

// Next.js template.tsx (в отличие от layout.tsx) пересоздаётся при каждой
// навигации — единственное место, где можно смягчить смену экрана лёгким
// fade без переделки каждой из ~30 страниц владельца/оператора под общий
// персистентный layout (запрос пользователя 2026-07-15: "самый простой
// дешёвый вариант и на этом всё" — жёсткая переработка на persistent shell
// обсуждалась, но признана слишком дорогой для этой правки).
export default function Template({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex min-h-full flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
