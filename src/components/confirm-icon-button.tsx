"use client";

import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/**
 * Мусорка с инлайн-подтверждением "Точно?" (запрос пользователя 2026-07-21:
 * "просто иконкой мусорки с подтверждением") — компактный аналог
 * ConfirmButton (src/components/confirm-button.tsx) для плотных строк, где
 * полноразмерная "Точно?" от ConfirmButton не годится: та жёстко рассчитана
 * на h-12/w-full ряд рядом с текстом, а не на иконку в строке билета/заказа.
 * Состояние покоя — маленькая круглая иконка. Состояние подтверждения —
 * НЕ инлайн-пилюля рядом с иконкой (первая версия была слишком мелкой и
 * зажатой между соседними элементами строки, запрос пользователя того же
 * дня: "надо крупнее, на всю ширину") — вместо этого абсолютно
 * спозиционированная плашка `inset-0`, перекрывающая ВЕСЬ родительский ряд
 * целиком (имя актива, статус, кнопку "Погасить" — всё, что было в строке).
 * Родитель обязан быть `relative` — см. использования в tickets/page.tsx и
 * money/readings/page.tsx.
 */
export function ConfirmIconButton({
  onConfirm,
  disabled,
  className,
  label,
  silent,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  label: string;
  silent?: boolean;
}) {
  const t = useI18n();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-control border border-primary bg-card font-semibold shadow-card-rest">
        <span className="text-body-airbnb font-semibold">{t.operatorApp.gameRoom.stopConfirmQuestion}</span>
        <PressableScale>
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setConfirming(false)}
            className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </PressableScale>
        <PressableScale>
          <button
            type="button"
            aria-label={t.common.confirm}
            disabled={disabled}
            onClick={(e) => {
              // Тот же приём, что ConfirmButton — улетающая галочка через
              // общий SaveSuccessOverlay ((app)/layout.tsx).
              const rect = e.currentTarget.getBoundingClientRect();
              window.dispatchEvent(
                new CustomEvent("save-success-fly", {
                  detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, silent },
                })
              );
              setConfirming(false);
              onConfirm();
            }}
            className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Check className="size-4" />
          </button>
        </PressableScale>
      </div>
    );
  }

  return (
    <PressableScale>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        aria-label={label}
        className={cn("size-9 shrink-0 rounded-full border-border text-destructive hover:text-destructive", className)}
      >
        <Trash2 className="size-4" />
      </Button>
    </PressableScale>
  );
}
