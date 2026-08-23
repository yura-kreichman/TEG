"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Выбирает тему по разделу приложения: PWA Сотрудника (/operator/*) — тёмная
 * по умолчанию и со своим ключом хранения, всё остальное (кабинет владельца,
 * вход/регистрация, админ-модуль) — светлая (docs/spec/03-design-system.md).
 *
 * Почему один провайдер с ветвлением, а не два вложенных, как было до
 * 2026-08-23: next-themes ≥0.4 делает ВЛОЖЕННЫЙ ThemeProvider пустышкой —
 * `useContext(ThemeContext) ? <>{children}</> : <Theme {...props}/>`
 * (node_modules/next-themes/dist/index.js). Провайдер оператора сидел внутри
 * корневого, поэтому его `defaultTheme="dark"` и `storageKey` не работали
 * вовсе: PWA Сотрудника жила на ключе владельца, а переключатель темы внутри
 * неё перекрашивал заодно кабинет владельца, экраны входа/регистрации и
 * админку на этом устройстве (нашёл владелец 2026-08-23 на проде — «и админка,
 * и вход, и регистрация в тёмной теме»). Диагноз подтверждён по выдаче прода:
 * в HTML /operator/login был ровно один инлайновый скрипт темы, и тот с
 * ("class","teg-theme-owner","light").
 *
 * `key` — не украшение: next-themes читает localStorage один раз, в
 * инициализаторе useState, поэтому смена storageKey у уже смонтированного
 * провайдера ничего бы не перечитала. Пересборка провайдера происходит только
 * на переходе между кабинетом и PWA (экраны входа), внутри раздела —
 * никогда.
 */
export function AppThemeProvider({
  nonce,
  children,
}: {
  nonce: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Именно с "/" на конце: у владельца есть свой раздел /operators
  // (Сотрудники), и startsWith("/operator") утащил бы его в тёмную тему.
  const isOperator = pathname === "/operator" || pathname.startsWith("/operator/");

  return (
    <ThemeProvider
      key={isOperator ? "operator" : "owner"}
      attribute="class"
      defaultTheme={isOperator ? "dark" : "light"}
      enableSystem={false}
      storageKey={isOperator ? "teg-theme-operator" : "teg-theme-owner"}
      nonce={nonce}
    >
      {children}
    </ThemeProvider>
  );
}
