"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Справочная иконка ⓘ рядом с подписью контрола: короткая подпись остаётся в
 * строке, подробное объяснение прячется сюда (запрос пользователя 2026-08-12:
 * "длинные подсказки к контролам у владельца... спрятать в Tooltip более
 * подробные описания" — на телефоне подпись в 250 символов занимала под
 * строкой-тумблером четыре строки текста).
 *
 * Правило, по которому текст делится: ПОДПИСЬ говорит, что это; ТУЛТИП — как
 * это работает и что изменится, если переключить. Строка настройки при этом
 * везде остаётся однострочной.
 *
 * Родоначальник — CellTooltip теплокарты в reports/[pointId]/page.tsx: он
 * приколочен к ячейке календаря (своя позиция, смайлики, автогашение через
 * 2с) и намеренно НЕ обобщался в этот компонент — у него другая задача
 * (точное значение поверх сокращённого), общего осталась только анимация.
 *
 * Позиционируется через position:fixed + портал в document.body, а не
 * absolute внутри строки. Причина конкретная: карточки настроек — это
 * SpringCard (framer-motion), а whileHover={{y:-3}} вешает на элемент
 * transform, и любой transform у предка создаёт containing block для
 * position:fixed — тултип уехал бы вместе с карточкой. Портал разрывает эту
 * связь целиком, заодно решая обрезание в bottom sheet'ах.
 */
export function InfoTooltip({
  text,
  className,
  ariaLabel,
  icon: Icon = Info,
}: {
  text: React.ReactNode;
  className?: string;
  /** Для скринридера, если подписи рядом недостаточно. */
  ariaLabel?: string;
  /**
   * Иконка-триггер. По умолчанию ⓘ — «подробнее об этом контроле». Другая
   * иконка нужна там, где тултип раскрывает не пояснение, а сам спрятанный
   * контент: комментарий сотрудника к расходу открывается message-square-more
   * (запрос владельца 2026-08-16), и ⓘ там читалась бы как справка.
   */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; placement: "top" | "bottom" } | null>(null);

  // useLayoutEffect, не useEffect — позицию надо посчитать до первой отрисовки
  // панели, иначе она успевает мигнуть в левом верхнем углу экрана.
  //
  // При закрытии позицию НЕ сбрасываем (это ещё и ловил бы
  // react-hooks/set-state-in-effect): пересчёт при следующем открытии всё
  // равно происходит в этом же layout-эффекте, то есть до кадра отрисовки —
  // устаревшие координаты на экран попасть не успевают. Сброс же в null
  // прямо во время exit-анимации схлопнул бы панель в угол на её глазах.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = 8;
    // Над иконкой, если сверху хватает места; иначе под ней — у нижних строк
    // длинной плашки настроек места сверху обычно больше, у верхних наоборот.
    const placement: "top" | "bottom" =
      anchor.top - panelRect.height - margin >= margin ? "top" : "bottom";
    const top = placement === "top" ? anchor.top - panelRect.height - margin : anchor.bottom + margin;
    // Центрируем по иконке и прижимаем к экрану, чтобы у правого края строки
    // панель не уезжала за пределы вьюпорта на телефоне.
    const rawLeft = anchor.left + anchor.width / 2 - panelRect.width / 2;
    const left = Math.min(Math.max(margin, rawLeft), window.innerWidth - panelRect.width - margin);
    setPosition({ left, top, placement });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    // Скролл закрывает, а не пересчитывает позицию: панель прибита к вьюпорту
    // (position:fixed) и при прокрутке страницы просто отвязалась бы от своей
    // иконки. Тултип короткоживущий, закрыть его дешевле, чем тащить следом.
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => {
          // Строки настроек — часто сами кликабельные (SettingsRow ведёт на
          // экран правки); тап по ⓘ не должен заодно открывать её.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        // Наведение — только там, где есть настоящий курсор: на тач-экране
        // hover эмулируется тапом и тултип открывался бы дважды.
        onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground",
          open && "text-foreground",
          className
        )}
      >
        <Icon className="size-3.5" />
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                role="tooltip"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                style={{
                  left: position?.left ?? 0,
                  top: position?.top ?? 0,
                  // До первого замера панель невидима, но уже отрисована —
                  // иначе нечего было бы мерить (см. useLayoutEffect выше).
                  visibility: position ? "visible" : "hidden",
                }}
                // Кегль тот же, что у подписи контрола рядом (text-body-airbnb),
                // а не caption (запрос пользователя 2026-08-12: "слишком мелко
                // и не видно") — это связный текст на несколько строк, его
                // читают, а не скользят взглядом, поэтому и leading-relaxed.
                className="fixed z-60 w-max max-w-[min(22rem,calc(100vw-2rem))] rounded-control border border-border bg-popover px-3.5 py-2.5 text-body-airbnb leading-relaxed text-popover-foreground shadow-floating"
              >
                {text}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
