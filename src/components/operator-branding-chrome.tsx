"use client";

import { useEffect, useState } from "react";
import { TenantLogoWatermark } from "@/components/tenant-logo-watermark";
import { PoweredByMark } from "@/components/powered-by-mark";
import { BgEffectLayer, type BgEffect } from "@/components/bg-effects";
import { useLiveRefetch } from "@/hooks/use-live-refetch";

/**
 * Декоративное фирменное оформление PWA Сотрудника (запрос пользователя
 * 2026-07-27: "логотип компании... декоративный элемент и под паттерном
 * владельца"). Логотип — TenantLogoWatermark, на всех платформах, включая
 * Android (запрос того же дня: "везде с такой 20% видимостью, что-то
 * фоновое"). Подпись "Работает на RentOS" — PoweredByMark, только md+
 * (запрос был именно про десктоп/Windows, отдельно от логотипа). Фоновый
 * эффект — BgEffectLayer, под нижним баром (запрос того же дня, "давай
 * подумаем" → волны → выбор эффекта), Tenant.bgEffect (Настройки → Внешний
 * вид).
 *
 * bottom — реальный баг, найден пользователем 2026-07-27 (живое фото
 * планшета): нижний бар PWA Сотрудника виден на ЛЮБОЙ ширине экрана
 * (OperatorBottomNav hideOnDesktop={false}, в отличие от owner-shell.tsx,
 * где бар прячется ровно на том же md+, где появляется PoweredByMark, —
 * там коллизии нет). Здесь bottom-2 утыкался прямо под непрозрачный бар и
 * был физически не виден — 4.5rem поднимает плашку выше бара (тот резервирует
 * себе ровно 4rem, см. OperatorBottomNav).
 */
export function OperatorBrandingChrome() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bgEffect, setBgEffect] = useState<BgEffect>("waves");
  const [loaded, setLoaded] = useState(false);

  function loadBranding() {
    fetch("/api/operator/print-branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setLogoUrl(data?.logoUrl ?? null);
        setBgEffect((data?.bgEffect ?? "waves") as BgEffect);
        setLoaded(true);
        // Акцентная схема (реальный баг, найден пользователем 2026-07-28:
        // "акцентная схема владельца не влияет на цвета у сотрудника") —
        // раньше PWA Сотрудника получал её ТОЛЬКО в момент логина
        // (cookie, api/auth/operator/login/route.ts), а сессия оператора
        // может часами держаться открытой на терминале точки — смена
        // владельцем схемы уже ЗАЛОГИНЕННЫЙ оператор не видел без
        // повторного входа. Прямая DOM-мутация — тот же приём, что
        // AccentPicker использует в кабинете владельца для мгновенного
        // применения без перезагрузки страницы.
        if (data?.accentScheme) {
          document.documentElement.setAttribute("data-accent", data.accentScheme);
        }
      })
      .catch(() => {});
  }

  useEffect(loadBranding, []);
  // useLiveRefetch — тот же приём, что держит остальные "живые" данные PWA
  // Сотрудника свежими без перезахода (устройство-терминал точки может
  // часами оставаться открытым на одном экране).
  useLiveRefetch(loadBranding);

  // Реальный баг, найден пользователем 2026-07-28 живыми скриншотами Safari
  // (iOS): даже с translateZ(0) на самих слоях (bg-effects/index.tsx,
  // tenant-logo-watermark.tsx) волны/логотип оставались невидимы, пока
  // оператор не потянет страницу — известная особенность iOS Safari:
  // position:fixed элементы, появившиеся/изменившиеся ПОСЛЕ первой отрисовки
  // (а этот компонент — client-side, содержимое приходит асинхронным fetch
  // выше), иногда не перерасчитываются до первого реального скролл-события,
  // а не просто не промотируются в composited layer. Микро-скролл (1px
  // вниз-вверх) сразу после того, как реальные данные приходят (loaded, не
  // сравнение с дефолтами — тенант с ДЕЙСТВИТЕЛЬНО пустым логотипом и
  // "waves" по умолчанию иначе никогда не получил бы этот пинок), форсирует
  // пересчёт программно, не дожидаясь жеста пользователя.
  useEffect(() => {
    if (!loaded) return;
    const raf = requestAnimationFrame(() => {
      window.scrollTo(0, 1);
      window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  return (
    <>
      <TenantLogoWatermark logoUrl={logoUrl} />
      <BgEffectLayer effect={bgEffect} />
      <PoweredByMark className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 hidden md:inline-flex" />
    </>
  );
}
