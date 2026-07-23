"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface ConfirmButtonProps {
  onConfirm: () => void | Promise<unknown>;
  disabled?: boolean;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  children: React.ReactNode;
  /** true только там, где вызывающий экран уже играет свой отдельный звук
   * подтверждения (Пуски/Прибывания — playConfirmChime/playCloseChime) —
   * иначе звук "дзинь" при вылетающей галочке играет по умолчанию, как и
   * у SaveButton (запрос пользователя 2026-07-20: реальный баг, найден
   * пользователем — покупка абонемента через эту же кнопку вообще была без
   * звука, потому что silent раньше был жёстко зашит внутри компонента). */
  silent?: boolean;
  /** Для кнопок внутри плотной строки (например, "Погасить" в строке билета,
   * рядом с именем актива) — обычный w-full у состояния подтверждения там
   * растягивается только на свой узкий flex-слот, а не на всю строку, и
   * "Точно?" остаётся тесным (запрос пользователя 2026-07-21: "должно быть
   * на всю ширину", тот же фикс, что уже сделан у ConfirmIconButton).
   * Вместо обычного потока — absolute inset-0 поверх РОДИТЕЛЯ (тот обязан
   * быть position:relative), перекрывает всю строку целиком. */
  fillParent?: boolean;
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
export function ConfirmButton({
  onConfirm,
  disabled,
  className,
  variant = "outline",
  children,
  silent,
  fillParent,
}: ConfirmButtonProps) {
  const t = useI18n();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className={cn(
          fillParent
            ? "absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-lg border border-primary bg-card font-semibold"
            : "relative flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-primary bg-card font-semibold",
          !fillParent && className
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
              //
              // Ждём результат onConfirm ПЕРЕД галочкой/звуком, не до него
              // (аудит 2026-07-24: раньше "дзинь" и улетающая галочка играли
              // синхронно на самом тапе, ДО того, как асинхронный запрос
              // вообще стартовал — на денежных подтверждениях (продажа,
              // оплата пуска, списание с абонемента) это ложноположительная
              // обратная связь "готово", если запрос ещё не завершился или
              // вовсе не начался). Вызывающие экраны сами ловят свои
              // ошибки (setError) и не пробрасывают исключение наружу —
              // await здесь как минимум гарантирует, что сетевой раунд-трип
              // уже произошёл, а не досрочный сигнал успеха при ещё не
              // отправленном запросе.
              const rect = e.currentTarget.getBoundingClientRect();
              setConfirming(false);
              Promise.resolve(onConfirm()).finally(() => {
                window.dispatchEvent(
                  new CustomEvent("save-success-fly", {
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
      <Button type="button" variant={variant} className={className} disabled={disabled} onClick={() => setConfirming(true)}>
        {children}
      </Button>
    </PressableScale>
  );
}
