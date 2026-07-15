"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";

// Мини-палитра на пресет (3 тона от var(--primary) через color-mix), не
// плоский квадрат — по образцу, который прислал пользователь (Adobe Kuler:
// полоска из нескольких тонов + подпись). Новых цветовых токенов не заводим —
// оттенки чисто презентационные, выводятся из уже существующего --primary
// схемы. data-accent={scheme} на самой карточке — тот же приём, что был в
// исходном компоненте: переопределяет --primary внутри своего поддерева на
// цвет ИМЕННО этого пресета, не трогая активную тему всей страницы. Класс
// .dark добавляется отдельно (из реального resolvedTheme), иначे превью
// пресетов в тёмной теме показывало бы их светлый вариант — см.
// [data-accent="x"].dark в globals.css (составной селектор, не потомок).
function SchemeSwatch({
  scheme,
  label,
  selected,
  dark,
  disabled,
  onClick,
}: {
  scheme: string;
  label: string;
  selected: boolean;
  dark: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      data-accent={scheme}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-control border p-1.5 text-left transition-colors",
        selected ? "border-foreground" : "border-border hover:border-foreground/30",
        dark && "dark"
      )}
    >
      {selected && (
        <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
          <Check className="size-3" />
        </span>
      )}
      <span className="flex h-9 overflow-hidden rounded-[10px]">
        <span className="flex-1" style={{ background: "color-mix(in oklch, var(--primary), white 45%)" }} />
        <span className="flex-1" style={{ background: "var(--primary)" }} />
        <span className="flex-1" style={{ background: "color-mix(in oklch, var(--primary), black 25%)" }} />
      </span>
      <span className="truncate text-xs font-medium text-foreground">{label}</span>
    </button>
  );
}

export function AccentPicker() {
  const t = useI18n();
  const { resolvedTheme } = useTheme();
  const labels: Record<string, string> = t.settings.accentNames;
  const [options, setOptions] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>("green");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/tenant/appearance")
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.accentOptions ?? []);
        setCurrent(data.accentScheme ?? "green");
      });
  }, []);

  async function handleSelect(scheme: string) {
    setSaving(true);
    setCurrent(scheme);
    // CSS-переменные каскадятся от <html data-accent> вниз браузером сразу
    // же — этого одного достаточно, router.refresh() здесь специально НЕ
    // вызываем: RootLayout — серверный компонент, рендерящий тот же атрибут
    // из куки (src/app/layout.tsx, data-accent={accent}) как React-проп;
    // если refresh() успевает прочитать куку до того, как её реально
    // обновит fetch ниже (гонка), React перезапишет атрибут обратно на
    // старое значение поверх этой ручной установки — именно это и было
    // причиной бага "не переключается на самом экране настроек".
    document.documentElement.setAttribute("data-accent", scheme);
    await fetch("/api/tenant/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accentScheme: scheme }),
    });
    setSaving(false);
  }

  if (options.length === 0 || !mounted) return null;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {options.map((scheme) => (
        <SchemeSwatch
          key={scheme}
          scheme={scheme}
          label={labels[scheme] ?? scheme}
          selected={current === scheme}
          dark={resolvedTheme === "dark"}
          disabled={saving}
          onClick={() => handleSelect(scheme)}
        />
      ))}
    </div>
  );
}
