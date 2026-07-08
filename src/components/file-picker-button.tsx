"use client";

import { useRef, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface FilePickerButtonProps {
  accept: string;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  hasFile?: boolean;
  className?: string;
}

// Native <input type="file"> renders the OS's raw "Choose file / No file
// chosen" chrome — replaced everywhere with this pill button matching the
// operator app's light pill style (e.g. "Сменить точку").
export function FilePickerButton({ accept, onFileSelected, disabled, hasFile, className }: FilePickerButtonProps) {
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
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground disabled:opacity-50",
          className
        )}
      >
        <Upload className="size-3.5" />
        {hasFile ? t.common.changeFile : t.common.chooseFile}
      </button>
    </>
  );
}
