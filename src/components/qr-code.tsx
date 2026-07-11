"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";

const ZOOM_SIZE = 320;

/** Renders a QR code for a device activation link (docs/spec/00-architecture.md). Tap to enlarge. */
export function QrCode({ value, alt, size = 180 }: { value: string; alt: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: Math.max(size, ZOOM_SIZE), margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="mx-auto animate-pulse rounded-control bg-muted"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="mx-auto block"
        aria-label={alt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image doesn't support it */}
        <img src={dataUrl} alt={alt} width={size} height={size} className="rounded-control" />
      </button>
      <AnimatePresence>
        {zoomed && (
          <motion.div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setZoomed(false)}
          >
            <motion.img
              src={dataUrl}
              alt={alt}
              width={ZOOM_SIZE}
              height={ZOOM_SIZE}
              className="max-h-full max-w-full rounded-card bg-white p-4"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
