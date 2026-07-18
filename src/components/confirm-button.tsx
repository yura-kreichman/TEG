"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface ConfirmButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  children: React.ReactNode;
}

/**
 * Кнопка способа оплаты (Наличные/Безнал/Абонемент) с обязательным вторым
 * тапом-подтверждением "Точно?" (запрос пользователя 2026-07-18) — тот же
 * принцип "переспроса", что уже был инлайн в тайле пуска (стоп-подтверждение
 * в game-room/page.tsx), просто оформлен как переиспользуемая обёртка для
 * кнопки-строки: первый тап переключает саму кнопку в состояние вопроса
 * ("Точно?" + ✕/✓), реальное действие срабатывает только на подтверждении.
 * Деньги реально списываются/приходят по этим кнопкам — случайный тап не
 * должен сразу списывать с абонемента или запускать оплаченный пуск.
 */
export function ConfirmButton({ onConfirm, disabled, className, variant = "outline", children }: ConfirmButtonProps) {
  const t = useI18n();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className={cn(
          "relative flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-primary bg-card font-semibold",
          className
        )}
      >
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
              // Улетающая зелёная галочка — тот же приём, что у SaveButton
              // (запрос пользователя 2026-07-18: "как мы делали при
              // сохранении"), тот же глобальный SaveSuccessOverlay
              // ((app)/layout.tsx), просто запущен напрямую по клику
              // (useFlyOnShow рассчитан на переход false→true пропса, тут
              // подтверждение — мгновенное действие, а не пропс).
              const rect = e.currentTarget.getBoundingClientRect();
              window.dispatchEvent(
                new CustomEvent("save-success-fly", {
                  detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
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
      <Button type="button" variant={variant} className={className} disabled={disabled} onClick={() => setConfirming(true)}>
        {children}
      </Button>
    </PressableScale>
  );
}
