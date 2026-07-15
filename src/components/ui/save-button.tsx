"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";

// Более выраженный "объёмный" bevel, чем у обычной кнопки variant="default"
// (референс — тот же UI kit mikedonovandesign.com, что и у Switch, решение
// пользователя 2026-07-14) — специально для кнопки "Сохранить" по всему
// проекту, не для кнопок вообще: акцент на главном действии формы/bottom
// sheet. Обратная связь об успехе — не смена текста на "Сохранено" (как
// было раньше в каждом месте по-своему), а галочка, которая быстро
// появляется справа с эффектом zoom и так же зумом исчезает — саму кнопку
// это больше не дёргает шириной/текстом. Логика "когда показывать" (флаг
// saved + auto-reset через 1500мс) остаётся на стороне вызывающей страницы,
// как и было — компонент только рендерит анимацию.
//
// Zoom заметно "вылетает" за 100% и потом садится на место (keyframes
// 0 → 1.6 → 1, не просто spring с лёгким перелётом — решение пользователя
// 2026-07-16 дважды: сначала "недостаточно заметно", потом явно попросили
// "прямо вылететь", чтобы однозначно читалось как подтверждение сохранения).
//
// Текст всегда "Сохранить" (решение пользователя 2026-07-16: разные подписи
// вроде "Добавить тариф"/"Создать ссылку активации" рядом с иконкой
// дискеты — тавтология, плюс лишние ключи перевода на каждое место) —
// children необязателен, кастомный текст нужен только в редких
// исключениях, не для обычного "сохранить форму".
export interface SaveButtonProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  children?: React.ReactNode;
  saved?: boolean;
}

function SaveButton({ children, saved, className, ...props }: SaveButtonProps) {
  const t = useI18n();
  return (
    <Button
      className={cn(
        "relative gap-1.5",
        "shadow-[0_3px_6px_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.22),inset_0_-2px_3px_rgba(0,0,0,.12)]",
        "hover:shadow-[0_4px_10px_rgba(0,0,0,.24),inset_0_1px_0_rgba(255,255,255,.25),inset_0_-2px_3px_rgba(0,0,0,.14)]",
        "active:shadow-[0_1px_2px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.16),inset_0_-1px_2px_rgba(0,0,0,.14)]",
        className
      )}
      {...props}
    >
      <Save className="size-4" />
      {children ?? t.common.save}
      <motion.span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center"
        initial={false}
        animate={{ scale: saved ? [0, 1.6, 1] : 0 }}
        transition={saved ? { duration: 0.45, times: [0, 0.55, 1], ease: "easeOut" } : { duration: 0.15, ease: "easeIn" }}
      >
        <Check className="size-4" />
      </motion.span>
    </Button>
  );
}

export { SaveButton };
