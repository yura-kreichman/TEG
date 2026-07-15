"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CURRENCIES, type CurrencyCode } from "@/lib/currency";
import { useI18n } from "@/components/i18n-provider";

// Сетка тайлов ~72px (docs/spec/03-design-system.md, "Числа и деньги" →
// "Настройка") — тот же приём выбора, что у пресетов акцента (AccentPicker):
// сразу видимая сетка кнопок, не скрытая в выпадающем списке, рамка
// акцентным цветом у выбранного тайла. Первый тайл — "Без валюты" (null,
// прочерк вместо знака) — значение по умолчанию.
function CurrencyTile({
  sign,
  code,
  selected,
  disabled,
  onClick,
}: {
  sign: string;
  code: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex size-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control border p-1 text-center transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30"
      )}
    >
      <span className="text-[1.5rem] font-semibold leading-none text-foreground">{sign}</span>
      <span className="text-[0.6875rem] font-medium leading-tight text-muted-foreground">{code}</span>
    </button>
  );
}

export function CurrencyPicker() {
  const t = useI18n();
  const [current, setCurrent] = useState<CurrencyCode | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/tenant/currency")
      .then((res) => res.json())
      .then((data) => {
        setCurrent(data.currency ?? null);
        setLoaded(true);
      });
  }, []);

  // Полная перезагрузка после сохранения, не router.refresh() — та же
  // причина, что у LocalePicker (2026-07-10): валюта резолвится в
  // серверном RootLayout один раз при монтировании, router.refresh() не
  // гарантированно перезапускает его в этой версии Next.js. Без этого
  // "мгновенно меняет знак во всех местах" (требование спеки) не работало
  // бы на уже открытых экранах — знак обновился бы только после ручного
  // перехода на другую страницу.
  async function handleSelect(currency: CurrencyCode | null) {
    setSaving(true);
    setCurrent(currency);
    await fetch("/api/tenant/currency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency }),
    });
    window.location.reload();
  }

  if (!loaded) return null;

  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      <CurrencyTile
        sign="—"
        code={t.settings.currencyNoneLabel}
        selected={current === null}
        disabled={saving}
        onClick={() => handleSelect(null)}
      />
      {CURRENCIES.map((c) => (
        <CurrencyTile
          key={c.code}
          sign={c.sign}
          code={c.code}
          selected={current === c.code}
          disabled={saving}
          onClick={() => handleSelect(c.code)}
        />
      ))}
    </div>
  );
}
