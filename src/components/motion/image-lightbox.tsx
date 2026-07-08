"use client";

import { AnimatePresence, motion } from "framer-motion";

interface ImageLightboxProps {
  src: string | null;
}

// Long-press preview for asset photos in the operator wizard — shown while
// the finger/pointer is held down, dismissed on release (src/app/operator/submit).
export function ImageLightbox({ src }: ImageLightboxProps) {
  return (
    <AnimatePresence>
      {src && (
        <motion.div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.img
            src={src}
            alt=""
            className="max-h-full max-w-full rounded-card object-contain"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
