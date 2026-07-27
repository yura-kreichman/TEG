// Логотип тенанта едва проглядывающим водяным знаком в углу (запрос
// пользователя 2026-07-27) — общий для кабинета Владельца и PWA Сотрудника
// (см. owner-shell.tsx/operator-branding-chrome.tsx), каждый сам решает,
// откуда взять logoUrl. z-index: -2 — строго ПОД общим фоновым узором
// (.app-bg в globals.css, z-index: -1). Нет логотипа — ничего не рендерим
// (запрос того же дня).
//
// dark:invert — запрос пользователя 2026-07-27, несколько заходов: сначала
// useTheme()+JS-фильтр (ценой hydration mismatch, реальный баг "ошибка на
// странице"), потом grayscale+dark:invert (убрали grayscale по запросу того
// же дня — известный компромисс: оригинальные цвета логотипа на светлой
// теме могут оказаться слишком светлыми/ненасыщенными при 20% и почти не
// читаться, это уже видели живьём при первой попытке без grayscale).
// Чистым CSS-классом через next-themes attribute="class" на <html>, без JS
// и без риска рассинхрона сервер/клиент — тот же приём, что dark: у
// остальных утилит в owner-shell.tsx.
//
// Маска — линейная от угла, не радиальная (реальный баг, тот же день:
// радиальная с default farthest-corner растягивала видимое "ядро"
// водяного знака почти на весь экран вместо мягкого затухания у самого
// угла).
const CORNER_FADE_MASK = "linear-gradient(to bottom left, black 0%, transparent 65%)";

export function TenantLogoWatermark({ logoUrl }: { logoUrl: string | null }) {
  if (!logoUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      aria-hidden
      className="pointer-events-none fixed right-0 top-0 w-40 opacity-40 dark:invert"
      style={{
        zIndex: -2,
        maskImage: CORNER_FADE_MASK,
        WebkitMaskImage: CORNER_FADE_MASK,
      }}
    />
  );
}
