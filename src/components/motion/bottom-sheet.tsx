"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Spring-driven bottom sheet per docs/spec/03-design-system.md: handle bar,
 * spring entrance, swipe-down-to-dismiss. This is the framer-motion primitive
 * called for in the spec's tech-base step; existing Base UI `Sheet` (CSS
 * transition based) stays in use where it's already wired up (e.g. IconPicker) —
 * migrate call sites to this one during the per-screen design rollout (ШАГ 4),
 * not as part of this infra step.
 */
export function BottomSheet({ open, onClose, children, className }: BottomSheetProps) {
  const t = useI18n();
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center">
            <motion.div
              role="dialog"
              aria-modal="true"
              className={cn(
                "relative flex max-h-[85vh] w-full flex-col rounded-t-block bg-card shadow-sheet sm:max-w-lg",
                className
              )}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_event, info) => {
                if (info.offset.y > 100 || info.velocity.y > 500) onClose();
              }}
            >
              {/* Шапка шторки: полоска-ручка по центру, крестик справа — обе
                  в собственной строке НАД содержимым.

                  Крестик стоит В ПОТОКЕ (правка 2026-09-01, запрос
                  пользователя со скриншотом). До этого он висел
                  `absolute top-3 right-3` поверх содержимого, и место под
                  него резервировалось несимметричными полями контейнера
                  (`pr-12 pl-4`). Отсюда три беды разом: содержимое было
                  сдвинуто влево (16px слева против 48px справа) и не
                  занимало ширину шторки; крестик торчал ПРАВЕЕ всех кнопок
                  и полей (его край в 12px от края шторки против 48px у
                  контента); и он стоял на одной высоте с первой строкой
                  содержимого, а не над ней.

                  Полоска-ручка позиционируется абсолютом, а не в потоке:
                  ей нужен центр шторки, а крестик в том же ряду сместил бы
                  её влево. Высоту ряда задаёт сама кнопка. */}
              <div className="relative flex shrink-0 items-center justify-end px-4 pt-2">
                <div className="absolute top-2 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onClose}
                  aria-label={t.common.close}
                  className="size-10 shrink-0 rounded-lg border-border"
                >
                  <X className="size-5" />
                </Button>
              </div>
              {/* Поля симметричные — содержимое занимает всю ширину шторки, и
                  его правый край совпадает с правым краем крестика выше. */}
              <div className="overflow-y-auto px-4 pb-4">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
