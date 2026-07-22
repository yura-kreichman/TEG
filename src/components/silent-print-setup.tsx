"use client";

import { useEffect, useState } from "react";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { useI18n } from "@/components/i18n-provider";

const STORAGE_KEY = "rentos_silent_print_configured";

// Есть ли смысл вообще показывать этот блок (запрос пользователя 2026-07-22):
// PWA как установленное отдельное окно (display-mode: standalone — работает
// одинаково на Android и Windows, никакого нативного моста не нужно) + это
// Windows + это Chromium (Edge/Chrome — только они понимают --kiosk-printing,
// у Firefox/других такого флага нет вовсе). Обычная вкладка браузера или
// Android/mac/Linux — блок не показываем, там либо не относится, либо флаг
// не сработает.
function detectSilentPrintEligible(): boolean {
  if (typeof window === "undefined") return false;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const ua = navigator.userAgent;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  const isWindows = /win/i.test(platform) || /windows/i.test(ua);
  const isChromium = /Chrome|Edg\//.test(ua) && !/OPR|Opera/.test(ua);
  return isStandalone && isWindows && isChromium;
}

// Диалог печати (window.print()) — платформенное ограничение веб-страниц, ни
// один JS API не даёт ни отключить его, ни узнать, отключён ли он уже (нет
// сигнала для detectSilentPrintEligible о статусе --kiosk-printing) — поэтому
// "исчезает, если всё настроено" реализовано честно, через ручное
// подтверждение Владельца после того, как он сам проверил тестовую печать,
// а не через автоопределение (которого не существует технически).
//
// Реальный баг, найден пользователем 2026-07-22 на живой машине: кириллица
// ВНУТРИ .bat (даже с UTF-8 BOM + chcp 65001) рвёт построчный разбор
// cmd.exe — многобайтовые UTF-8-последовательности читаются в неверной
// кодовой странице ДО того, как chcp успевает примениться, отдельные байты
// принимаются за разделители аргументов, и строка разваливается на
// случайные "неизвестные команды" (в этом случае оторвало даже путь до
// msedge.exe в предыдущей строке). BOM тоже не помог — cmd.exe ненадёжно
// его пропускает в .bat/.cmd (в отличие от PowerShell .ps1). Единственный
// по-настоящему надёжный вариант — держать сам .bat полностью в ASCII: ни
// кириллицы в echo, ни в имени создаваемого ярлыка.
function buildBatContent(url: string): string {
  const lines = [
    "@echo off",
    "setlocal",
    "",
    `set "URL=${url}"`,
    'set "SHORTCUT_NAME=RentOS (silent print).lnk"',
    'set "DESKTOP_SHORTCUT=%USERPROFILE%\\Desktop\\%SHORTCUT_NAME%"',
    'set "STARTUP_SHORTCUT=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\%SHORTCUT_NAME%"',
    'set "BROWSER="',
    "",
    // Реестр Windows (App Paths) — тот же механизм, которым сама ОС находит
    // exe по имени независимо от РЕАЛЬНОГО пути установки: покрывает и
    // machine-wide (Program Files), и per-user (без прав администратора,
    // например %LocalAppData%\Google\Chrome — частый случай для Chrome,
    // который жёстко прописанные пути ниже пропускали). HKLM сначала (Edge
    // почти всегда устанавливается на машину целиком), HKCU — для
    // per-user Chrome.
    "for /f \"tokens=2*\" %%A in ('reg query \"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe\" /ve 2>nul') do set \"BROWSER=%%B\"",
    "if not defined BROWSER for /f \"tokens=2*\" %%A in ('reg query \"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\" /ve 2>nul') do set \"BROWSER=%%B\"",
    "if not defined BROWSER for /f \"tokens=2*\" %%A in ('reg query \"HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\" /ve 2>nul') do set \"BROWSER=%%B\"",
    "",
    // Запасной вариант — известные пути напрямую, если по какой-то причине
    // реестр недоступен (например политика безопасности блокирует reg.exe).
    'if not defined BROWSER if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not defined BROWSER if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not defined BROWSER if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not defined BROWSER if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not defined BROWSER if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    "",
    "if not defined BROWSER (",
    "  echo Edge or Chrome not found.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "powershell -NoProfile -Command \"$s = (New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP_SHORTCUT%'); $s.TargetPath = '%BROWSER%'; $s.Arguments = '--app=%URL% --kiosk-printing --profile-directory=Default'; $s.IconLocation = '%BROWSER%,0'; $s.Save()\"",
    // Автозагрузка (запрос пользователя 2026-07-22) — тот же ярлык, просто
    // копия в папку "Автозагрузка" текущего пользователя: терминал точки
    // открывает RentOS сам при входе в Windows, без ручного клика.
    'copy /y "%DESKTOP_SHORTCUT%" "%STARTUP_SHORTCUT%" > nul',
    "",
    "echo.",
    "echo Done. Shortcut \"RentOS (silent print)\" created on the Desktop",
    "echo and added to Windows Startup (opens automatically on login).",
    "echo Before first use, close ALL Edge/Chrome windows (including the system tray) -",
    "echo otherwise the new shortcut opens in the already-running process and the flag is ignored.",
    "echo From now on, open RentOS only through this new shortcut.",
    "echo.",
    "pause",
    "",
  ];
  return lines.join("\r\n");
}

function downloadBat(url: string) {
  const content = buildBatContent(url);
  // Без BOM и без не-ASCII байт вообще (см. комментарий у buildBatContent) —
  // обычный ANSI-совместимый .bat, который cmd.exe не может разобрать неверно.
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url_ = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url_;
  a.download = "rentos-silent-print-setup.bat";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url_);
}

/**
 * Настройки → Система, блок "Печать" (запрос пользователя 2026-07-22) —
 * скачиваемый .bat, создающий отдельный ярлык Windows с флагом
 * --kiosk-printing (печать сразу на принтер по умолчанию, без системного
 * диалога). Показывается только когда реально применимо (см.
 * detectSilentPrintEligible) и пока Владелец сам не подтвердил, что настроил
 * (localStorage — состояние per-устройство, не per-тенант: у одного
 * владельца может быть несколько Windows-точек, каждая настраивается
 * отдельно на своём устройстве).
 */
export function SilentPrintSetupCard() {
  const t = useI18n();
  const [eligible, setEligible] = useState(false);
  // true по умолчанию — не мигать блоком, пока не проверили localStorage.
  const [configured, setConfigured] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEligible(detectSilentPrintEligible());
    setConfigured(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!eligible || configured) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="min-w-0">
        <p className="text-body-airbnb font-semibold">{t.settings.systemSilentPrintTitle}</p>
        <p className="text-caption-airbnb text-muted-foreground">{t.settings.systemSilentPrintHint}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <PressableScale className="flex-1">
          <Button
            type="button"
            variant="outline"
            className="w-full gap-1.5 rounded-lg"
            onClick={() => downloadBat(`${window.location.origin}/`)}
          >
            <Download className="size-4" />
            {t.settings.systemSilentPrintDownloadButton}
          </Button>
        </PressableScale>
        <PressableScale className="flex-1">
          <Button
            type="button"
            variant="outline"
            className="w-full gap-1.5 rounded-lg"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, "1");
              setConfigured(true);
            }}
          >
            <Check className="size-4" />
            {t.settings.systemSilentPrintConfirmButton}
          </Button>
        </PressableScale>
      </div>
    </div>
  );
}
