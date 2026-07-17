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
              <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onClose}
                aria-label={t.common.close}
                className="absolute top-3 right-3 z-10 size-10 shrink-0 rounded-full border-border"
              >
                <X className="size-5" />
              </Button>
              <div className="overflow-y-auto py-1 pr-12 pb-4 pl-4">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
