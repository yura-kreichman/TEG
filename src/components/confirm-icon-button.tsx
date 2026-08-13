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
 *
 * Обратная связь об успехе — разлетающиеся осколки (DeleteSuccessOverlay,
 * событие "delete-success-explode") и звук отмены, а НЕ улетающая зелёная
 * галочка сохранения со своим "дзинем" (2026-08-13). До этого все четыре
 * места вызова — аннулирование заказа, билета и пуска — и выглядели, и
 * звучали ровно как успешная продажа. Разделение "сохранение — галочка в
 * центр, удаление — взрыв на месте" принято 2026-07-16, этот компонент
 * появился позже и в него не попал.
 */
export function ConfirmIconButton({
  onConfirm,
  disabled,
  className,
  label,
  silent,
}: {
  onConfirm: () => unknown;
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
              // Ждём результат onConfirm ПЕРЕД галочкой/звуком, не до него
              // (аудит 2026-07-27) — тот же фикс, что уже применён в
              // ConfirmButton 2026-07-24 (см. её комментарий), но пропущен
              // здесь: галочка/"дзинь" улетали синхронно на самом тапе, ДО
              // того, как запрос на аннулирование/удаление вообще стартовал —
              // ложноположительный "успех" даже если сеть недоступна или
              // сервер отклонил действие (например билет уже погашен другим
              // оператором).
              const rect = e.currentTarget.getBoundingClientRect();
              setConfirming(false);
              Promise.resolve(onConfirm()).finally(() => {
                window.dispatchEvent(
                  new CustomEvent("delete-success-explode", {
                    detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, silent },
                  })
                );
              });
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
        className={cn("size-9 shrink-0 rounded-lg border-border text-destructive hover:text-destructive", className)}
      >
        <Trash2 className="size-4" />
      </Button>
    </PressableScale>
  );
}
