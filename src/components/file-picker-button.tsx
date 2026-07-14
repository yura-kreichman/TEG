"use client";

import { useRef, type ChangeEvent } from "react";
import { ImagePlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

interface FilePickerButtonProps {
  accept: string;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  hasFile?: boolean;
  className?: string;
  // Иконка по теме файла — по умолчанию ImagePlus (все 3 текущих места
  // вызова принимают только фото), но задаётся снаружи на будущее, если
  // появится пикер не для изображений (докс: единая кнопка-по-проекту,
  // решение пользователя 2026-07-14 — "иконка по теме, для файла своя").
  icon?: LucideIcon;
}

// Native <input type="file"> renders the OS's raw "Choose file / No file
// chosen" chrome — заменяется везде этой кнопкой. Общий компонент Button
// (variant="outline" size="sm"), тот же стиль, что "Заменить видео" в
// настройках Лендинга — раньше был бесповодный pill со своим CSS, из-за
// чего кнопки выбора файла по проекту visually не совпадали с остальными
// (решение пользователя 2026-07-14: "везде по проекту разные кнопки").
export function FilePickerButton({ accept, onFileSelected, disabled, hasFile, className, icon: Icon = ImagePlus }: FilePickerButtonProps) {
  const t = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFileSelected(file);
    event.target.value = "";
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} disabled={disabled} className="hidden" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={className}
      >
        <Icon />
        {hasFile ? t.common.changeFile : t.common.chooseFile}
      </Button>
    </>
  );
}
