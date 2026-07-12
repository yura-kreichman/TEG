"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface SignatureCanvasHandle {
  isEmpty: () => boolean;
  clear: () => void;
  toDataURL: () => string;
}

// Канвас подписи (docs/spec/07-instructions.md, "Подписание" + "Макеты и
// вёрстка"): палец/мышь через Pointer Events (единый API для touch+mouse, не
// два отдельных набора обработчиков), retina-чёткость через масштабирование
// backing store по devicePixelRatio при неизменном CSS-размере — стандартный
// приём для canvas на Hi-DPI экранах. Белый фон — литерально, не токен темы:
// это имитация бумаги/чернил (штрих #1B2A8F по спеке), должна оставаться
// белой независимо от системной тёмной темы читателя.
export const SignatureCanvas = forwardRef<SignatureCanvasHandle, { onChange?: (empty: boolean) => void }>(
  function SignatureCanvas({ onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const drawingRef = useRef(false);
    const hasStrokeRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#1B2A8F";
      }
    }, []);

    function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      lastPointRef.current = getPoint(e);
    }

    function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) return;
      e.preventDefault();
      const ctx = canvasRef.current?.getContext("2d");
      const point = getPoint(e);
      if (ctx && lastPointRef.current) {
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      lastPointRef.current = point;
      if (!hasStrokeRef.current) {
        hasStrokeRef.current = true;
        onChange?.(false);
      }
    }

    function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
      drawingRef.current = false;
      lastPointRef.current = null;
      canvasRef.current?.releasePointerCapture(e.pointerId);
    }

    useImperativeHandle(ref, () => ({
      isEmpty: () => !hasStrokeRef.current,
      clear: () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasStrokeRef.current = false;
        onChange?.(true);
      },
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
    }));

    return (
      // border-input то же самое "не видно" замечание, что чинили для
      // Checkbox (border-foreground/25 вместо почти сливающегося с фоном
      // border-input) — здесь ещё важнее: пунктир должен явно читаться как
      // "здесь распишитесь", а не потеряться на светлом surface-0.
      <div
        ref={containerRef}
        className="h-40 w-full touch-none overflow-hidden rounded-control border-2 border-dashed border-foreground/25 bg-white shadow-xs"
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    );
  }
);
