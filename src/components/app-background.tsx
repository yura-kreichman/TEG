import type { BgStyle } from "@/lib/bg-style";

// Рендерится в src/app/(app)/layout.tsx (кабинет владельца) до {children} —
// position:fixed в globals.css (.app-bg) уводит его из потока, порядок в DOM
// не важен для раскладки, но так он логически "позади" контента. Div
// присутствует всегда (даже при "none") с фиксированным id — BgStylePicker
// находит его напрямую и переставляет data-bg-style для мгновенного
// оптимистичного применения, тем же приёмом, что AccentPicker с data-accent
// на <html>. Без data-bg-style ни одно правило-селектор в globals.css не
// срабатывает, слой прозрачен — визуально то же самое, что "не рендерить".
export function AppBackground({ style }: { style: BgStyle }) {
  return <div id="app-bg-layer" aria-hidden className="app-bg" data-bg-style={style === "none" ? undefined : style} />;
}
