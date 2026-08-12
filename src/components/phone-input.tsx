"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  /** Номер как есть — что набрали, то и хранится. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoFocus?: boolean;
  heightClassName?: string;
  /** Размер шрифта поля (запрос пользователя 2026-07-22: "как в Заказах"). */
  sizeClassName?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  required?: boolean;
}

/**
 * Поле номера телефона. Просто поле: что набрали, то и сохранилось.
 *
 * ЧТО ЗДЕСЬ БЫЛО РАНЬШЕ И ПОЧЕМУ УБРАНО (решение пользователя 2026-08-13).
 * Слева стоял read-only блок «флаг + код страны», выведенный из часового
 * пояса тенанта (запрос 2026-07-17), а в поле набиралась только местная
 * часть. Компонент при этом сам ходил за часовым поясом, срезал транковый
 * префикс местного набора и склеивал результат с кодом страны.
 *
 * Всё это ломалось ровно там, где было нужнее всего:
 * - Иностранца ввести было НЕЧЕМ: код страны один на весь бизнес, поменять
 *   его в поле невозможно. Турист сохранялся как «код Молдовы + итальянский
 *   номер» — правдоподобная строка, не являющаяся ничьим телефоном.
 * - Срез транкового префикса знал только про ведущий ноль (верно для
 *   Молдовы), а в зоне +7 местная запись начинается с восьмёрки: «8 701 234
 *   5678» превращалось в двенадцатизначный несуществующий номер.
 * - С открытием всех зон IANA (2026-08-13) появились страны, про которые мы
 *   не знаем кода вовсе — подсказка стала бы враньём (американец видел бы
 *   российский флаг).
 *
 * Опора теперь не на формат ввода, а на сопоставление: AbonementWallet.phoneKey
 * — последние 8 цифр — сводит вместе один и тот же номер, записанный
 * по-разному. Поэтому разнобой в поле больше не опасен, и городить режимы
 * незачем.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  autoFocus,
  heightClassName = "h-12",
  sizeClassName,
  onKeyDown,
  required,
}: PhoneInputProps) {
  // Автофокус — ТОЛЬКО на устройствах с мышью/клавиатурой (запрос
  // пользователя 2026-07-22: "не будет ли неудобно, что сразу и наш нумпад,
  // и штатная клавиатура") — на тач-устройстве autoFocus сразу же вызвал бы
  // системную клавиатуру поверх уже показанного нумпада, задваивая ввод.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Input
      ref={inputRef}
      id={id}
      type="tel"
      inputMode="tel"
      value={value}
      // Разрешены цифры, пробелы, скобки, дефис и "+" — всё, чем реально
      // записывают номера. Ничего не срезаем и не дописываем: сведением
      // разных записей одного номера занимается phoneKey, а не поле.
      onChange={(e) => onChange(e.target.value.replace(/[^\d\s()+-]/g, ""))}
      onKeyDown={onKeyDown}
      required={required}
      className={cn(heightClassName, sizeClassName)}
    />
  );
}
