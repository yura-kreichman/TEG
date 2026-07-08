"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEM_HEIGHT = 44;
const VISIBLE_HEIGHT = ITEM_HEIGHT * 3;
const PAD = (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2;
const STEPPER_SIZE = 28;
const STEPPER_GAP = 4;
const COLUMN_HEIGHT = STEPPER_SIZE * 2 + STEPPER_GAP * 2 + VISIBLE_HEIGHT;

function WheelColumn({
  values,
  value,
  onChange,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ startY: number; startScrollTop: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = value * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [value]);

  function snapToScrollPosition() {
    const el = ref.current;
    if (!el) return;
    const index = Math.round(el.scrollTop / ITEM_HEIGHT);
    const clamped = Math.min(Math.max(index, 0), values.length - 1);
    el.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: "smooth" });
    if (values[clamped] !== value) onChange(values[clamped]);
  }

  function handleScroll() {
    if (drag.current) return; // во время активного перетаскивания снап решаем на pointerup, не на каждый кадр
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(snapToScrollPosition, 120);
  }

  // Тач/перо скроллят колонку нативно (touch-action: pan-y) — здесь только
  // мышь: без тачскрина потянуть колёсико пальцем нельзя, а нативный drag
  // мышью по div с overflow браузеры не поддерживают сами по себе (это не то
  // же самое, что перетаскивание скроллбара). Без этого колесо было
  // управляемо только скроллом мыши/тачем — в вебе с обычной мышью выбор
  // времени физически не менялся.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    drag.current = { startY: e.clientY, startScrollTop: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !ref.current) return;
    ref.current.scrollTop = drag.current.startScrollTop - (e.clientY - drag.current.startY);
  }
  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    snapToScrollPosition();
  }

  return (
    <div className="relative" style={{ height: VISIBLE_HEIGHT }}>
      <div
        className="pointer-events-none absolute inset-x-0 rounded-control bg-muted"
        style={{ top: PAD, height: ITEM_HEIGHT }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="scrollbar-none relative select-none snap-y snap-mandatory overflow-y-scroll cursor-grab active:cursor-grabbing"
        style={{ height: VISIBLE_HEIGHT, paddingTop: PAD, paddingBottom: PAD }}
      >
        {values.map((v) => (
          <button
            key={v}
            type="button"
            // Клик по конкретному числу — запасной способ выбора без скролла/
            // перетаскивания вообще (работает при любом вводе).
            onClick={() => onChange(v)}
            className={cn(
              "flex w-full snap-center items-center justify-center text-[22px] font-bold tabular-nums transition-colors",
              v === value ? "text-foreground" : "text-muted-foreground/40"
            )}
            style={{ height: ITEM_HEIGHT }}
          >
            {String(v).padStart(2, "0")}
          </button>
        ))}
      </div>
    </div>
  );
}

// Колонка + кнопки шаг вперёд/назад — тот же степпер-паттерн, что уже
// используется для "Возвраты/тестовые пуски" в мастере сдачи итогов.
// Гарантированно рабочий способ сменить час/минуту независимо от того,
// работает ли скролл/перетаскивание колеса в конкретном браузере/окружении.
function WheelColumnWithSteppers({
  values,
  value,
  onChange,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  function step(delta: number) {
    const index = values.indexOf(value);
    const next = (index + delta + values.length) % values.length;
    onChange(values[next]);
  }

  return (
    <div className="flex flex-col items-center" style={{ gap: STEPPER_GAP }}>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="+1"
        className="flex items-center justify-center rounded-control text-muted-foreground"
        style={{ height: STEPPER_SIZE, width: STEPPER_SIZE }}
      >
        <ChevronUp className="size-4" />
      </button>
      <WheelColumn values={values} value={value} onChange={onChange} />
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="-1"
        className="flex items-center justify-center rounded-control text-muted-foreground"
        style={{ height: STEPPER_SIZE, width: STEPPER_SIZE }}
      >
        <ChevronDown className="size-4" />
      </button>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

// 24-часовой time picker "колёсиками" (docs/spec/05-work-time.md, "СМЕНА") —
// два вертикальных скролл-снап списка (часы/минуты), выбранное значение
// зафиксировано по центру подсвеченной полосой. Поддерживает тач/скролл
// мыши (нативно), перетаскивание мышью/клик по числу (см. WheelColumn) и
// кнопки +/- сверху/снизу каждой колонки как гарантированно рабочий способ
// на случай, если скролл/перетаскивание не сработает в конкретном браузере.
export function WheelTimePicker({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (v: { hour: number; minute: number }) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <WheelColumnWithSteppers values={HOURS} value={hour} onChange={(h) => onChange({ hour: h, minute })} />
      <div className="flex items-center justify-center" style={{ height: COLUMN_HEIGHT }}>
        <span className="text-[22px] font-bold text-muted-foreground">:</span>
      </div>
      <WheelColumnWithSteppers values={MINUTES} value={minute} onChange={(m) => onChange({ hour, minute: m })} />
    </div>
  );
}
