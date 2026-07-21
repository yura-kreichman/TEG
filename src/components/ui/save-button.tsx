"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { useFlyOnShow } from "@/hooks/use-fly-on-show";
import { checkPopAnimate, checkPopTransition } from "@/components/ui/check-pop-animation";

// Более выраженный "объёмный" bevel, чем у обычной кнопки variant="default"
// (референс — тот же UI kit mikedonovandesign.com, что и у Switch, решение
// пользователя 2026-07-14) — изначально было исключением специально для
// кнопки "Сохранить"; с 2026-07-22 тот же bevel — уже дефолт у variant="outline"
// в button.tsx (запрос пользователя: "такой дизайн должен быть у всех белых
// кнопок в проекте"), здесь оставлено как есть, чтобы кнопка "Сохранить"
// сохраняла акцент независимо от variant (в т.ч. variant="default", где у
// обычных кнопок тень легче). Обратная связь об успехе — не смена текста на "Сохранено" (как
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
//
// При переходе saved false→true кнопка сама шлёт координаты своего центра
// событием "save-success-fly" (запрос пользователя 2026-07-16: "чтобы
// галочка улетала в центр экрана", хук useFlyOnShow, общий с SavedCheckmark) —
// единственный слушатель этого события, SaveSuccessOverlay, смонтирован один
// раз в (app)/layout.tsx и рисует увеличенную галочку, летящую от кнопки к
// центру экрана. Якорь для координат — отдельный span на всю кнопку, а не
// сама Button/её DOM-узел (ButtonPrimitive не даёт гарантий по forwardRef) и
// не сам чек-span (у него в моменте анимируется transform: scale,
// getBoundingClientRect поймал бы кнопку в процессе анимации, а не
// стабильную позицию).
export interface SaveButtonProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  children?: React.ReactNode;
  saved?: boolean;
}

function SaveButton({ children, saved, className, ...props }: SaveButtonProps) {
  const t = useI18n();
  const anchorRef = useFlyOnShow<HTMLSpanElement>(!!saved, "save-success-fly");

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
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <Save className="size-4" />
      {children ?? t.common.save}
      <motion.span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center"
        initial={false}
        animate={checkPopAnimate(!!saved)}
        transition={checkPopTransition(!!saved)}
      >
        <Check className="size-4" />
      </motion.span>
    </Button>
  );
}

export { SaveButton };
