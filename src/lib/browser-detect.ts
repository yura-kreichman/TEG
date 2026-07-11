// Лёгкое определение браузера/ОС для точных пошаговых инструкций установки
// PWA (без beforeinstallprompt — Safari/iOS его не поддерживает вообще, а на
// части Android-браузеров, например Samsung Internet и MIUI-браузере, оно
// либо не срабатывает надёжно, либо ведёт себя иначе, чем в Chrome).
// Порядок проверок важен — Samsung/Opera/Edge на Android тоже содержат
// "Chrome" в UA (все на Chromium), поэтому Chrome проверяется последним.
// Подход подсмотрен у Progressify (WP-плагин, Progressify/assets/js/uaDetector.js) —
// там та же логика, просто через полноценный ua-parser-js; здесь достаточно
// точечных regex, чтобы не тащить лишнюю библиотеку.

export type AndroidBrowser = "samsung" | "opera" | "edge" | "firefox" | "chrome" | "other";

export function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ Safari представляется как "Mac" — отличаем от настоящего
  // macOS по наличию тач-точек (у ноутбуков/десктопов их нет).
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/.test(window.navigator.userAgent);
}

export function getAndroidBrowser(): AndroidBrowser {
  const ua = window.navigator.userAgent;
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return "opera";
  if (/EdgA\//.test(ua)) return "edge";
  if (/Firefox/.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

export function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  // На iOS все браузеры используют движок Safari, но у сторонних (Chrome,
  // Firefox для iOS и т.д.) в UA есть свой маркер — если его нет, это
  // настоящий Safari.
  return !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
}
