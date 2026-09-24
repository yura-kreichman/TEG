"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Единое поле ввода ПИН-кода — вход владельца и сотрудника, задание своего
// ПИН-кода. Раньше одни и те же атрибуты были скопированы в пять полей на
// трёх экранах.
//
// Не type="password" (запрос владельца 2026-09-17): на поле пароля Chrome
// после входа по ПИН предлагает «Обновить пароль?» для сохранённой почты — и
// autoComplete="off" игнорирует. ПИН — не пароль браузера. Точки даёт CSS,
// one-time-code менеджеры паролей не сохраняют.
//
// Текст по центру (запрос владельца 2026-09-24): курсор пустого поля стоит
// посередине, точки растут от центра в обе стороны.
export function PinInput({ className, ...props }: Omit<React.ComponentProps<typeof Input>, "type">) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="\d{4,6}"
      autoComplete="one-time-code"
      data-1p-ignore
      data-lpignore="true"
      className={cn("h-14 text-center text-lg tabular-nums [-webkit-text-security:disc]", className)}
      {...props}
    />
  );
}
