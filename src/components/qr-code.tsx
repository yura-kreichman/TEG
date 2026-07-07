"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a QR code for a device activation link (docs/spec/00-architecture.md). */
export function QrCode({ value, alt, size = 180 }: { value: string; alt: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 }).then((url) => {
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
        className="animate-pulse rounded-control bg-muted"
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image doesn't support it
  return <img src={dataUrl} alt={alt} width={size} height={size} className="rounded-control" />;
}
