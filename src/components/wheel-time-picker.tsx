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
  format = (v: number) => String(v).padStart(2, "0"),
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ startY: number; startScrollTop: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Реальный баг, найден пользователем 2026-07-22: "value * ITEM_HEIGHT"
    // молчаливо считал value ИНДЕКСОМ в массиве values, что верно только
    // для полного списка 0..N без пропусков (минуты, часы без ограничения).
    // У часов "Пришёл" в ручном учёте времени values — ОГРАНИЧЕННЫЙ список
    // (hourValues, окно допуска вокруг defaultShiftStartTime, не с нуля) —
    // так, для values=[9..19] значение 10 попадало на позицию индекса 10,
    // т.е. на элемент values[10] = 19, а не на сам "10". Нужен индекс
    // значения В МАССИВЕ, не само значение.
    const index = values.indexOf(value);
    if (index === -1) return;
    const target = index * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [value, values]);

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
              "flex w-full snap-center items-center justify-center text-[1.375rem] font-bold tabular-nums transition-colors",
              v === value ? "text-foreground" : "text-muted-foreground/40"
            )}
            style={{ height: ITEM_HEIGHT }}
          >
            {format(v)}
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
  format,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
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
      <WheelColumn values={values} value={value} onChange={onChange} format={format} />
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
function minutesForStep(step: number): number[] {
  return step <= 1 ? MINUTES : Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
}

// 24-часовой time picker "колёсиками" (docs/spec/05-work-time.md, "СМЕНА") —
// два вертикальных скролл-снап списка (часы/минуты), выбранное значение
// зафиксировано по центру подсвеченной полосой. Поддерживает тач/скролл
// мыши (нативно), перетаскивание мышью/клик по числу (см. WheelColumn) и
// кнопки +/- сверху/снизу каждой колонки как гарантированно рабочий способ
// на случай, если скролл/перетаскивание не сработает в конкретном браузере.
export function WheelTimePicker({
  hour,
  minute,
  minuteStep = 1,
  hourValues,
  onChange,
}: {
  hour: number;
  minute: number;
  minuteStep?: number;
  // Ограниченный список часов (docs/spec/05-work-time.md, "РЕЖИМ УЧЁТА
  // ВРЕМЕНИ", допуск раньше/позже начала) — если задан, колесо часов
  // прокручивает только эти значения вместо полных 0..23.
  hourValues?: number[];
  onChange: (v: { hour: number; minute: number }) => void;
}) {
  const minuteValues = minutesForStep(minuteStep);
  // Если пришедшее значение минут не кратно шагу (старые данные), приводим
  // к ближайшему разрешённому, чтобы колесо не «зависало» между делениями.
  const snappedMinute = minuteValues.reduce((closest, v) =>
    Math.abs(v - minute) < Math.abs(closest - minute) ? v : closest
  );
  const hoursList = hourValues && hourValues.length > 0 ? hourValues : HOURS;
  const snappedHour = hoursList.includes(hour)
    ? hour
    : hoursList.reduce((closest, v) => (Math.abs(v - hour) < Math.abs(closest - hour) ? v : closest));

  return (
    <div className="flex items-center gap-1">
      <WheelColumnWithSteppers values={hoursList} value={snappedHour} onChange={(h) => onChange({ hour: h, minute: snappedMinute })} />
      <div className="flex items-center justify-center" style={{ height: COLUMN_HEIGHT }}>
        <span className="text-[1.375rem] font-bold text-muted-foreground">:</span>
      </div>
      <WheelColumnWithSteppers values={minuteValues} value={snappedMinute} onChange={(m) => onChange({ hour: snappedHour, minute: m })} />
    </div>
  );
}

