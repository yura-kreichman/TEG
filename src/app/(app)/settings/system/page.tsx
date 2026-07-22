"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, FileText, Globe, ListChecks, ShoppingBag, Wallet, type LucideIcon } from "lucide-react";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/components/i18n-provider";
import type { Dictionary } from "@/lib/i18n";
import { OwnerShell } from "@/components/owner-shell";
import { useOwnerHasPrinterLocal } from "@/hooks/use-print";
import { PrintButton } from "@/components/print/print-button";
import { buildReceiptHtml, type PrintDocumentData } from "@/lib/print/receipt-document";
import { cn } from "@/lib/utils";

// Плашка "Модули" (запрос пользователя 2026-07-22) — множественный выбор,
// тем же визуальным паттерном, что CurrencyPicker (src/components/currency-picker.tsx),
// только там один тайл может быть выбран, а тут любое число сразу. Ключи —
// поля Tenant, см. schema.prisma для полного объяснения каждого модуля.
// "Рабочее время" НЕ входит (запрос пользователя 2026-07-22: "невозможно
// отключить... кто же будет вводить итоги тогда" — у него нет отдельного
// nav-пункта, живёт внутри Сотрудников, того же экрана, что PIN/доступ к
// зонам/вход оператора для сдачи итогов; риск спутать "выключить учёт часов"
// с "выключить самих сотрудников" перевесил пользу тумблера).
type ModuleKey = "instructionsEnabled" | "tasksEnabled" | "landingEnabled" | "goodsEnabled" | "clientsEnabled";

const MODULE_TILES: { key: ModuleKey; icon: LucideIcon; label: (t: Dictionary) => string }[] = [
  { key: "instructionsEnabled", icon: FileText, label: (t) => t.instructions.settingsTitle },
  { key: "tasksEnabled", icon: ListChecks, label: (t) => t.nav.tasks },
  { key: "landingEnabled", icon: Globe, label: (t) => t.landing.settingsTitle },
  { key: "goodsEnabled", icon: ShoppingBag, label: (t) => t.goods.navLabel },
  { key: "clientsEnabled", icon: Wallet, label: (t) => t.abonements.walletsTitle },
];

interface SystemSettings {
  goodsAllowBalancePayment: boolean;
  printingEnabled: boolean;
  instructionsEnabled: boolean;
  tasksEnabled: boolean;
  landingEnabled: boolean;
  goodsEnabled: boolean;
  clientsEnabled: boolean;
}

const DEFAULTS: SystemSettings = {
  goodsAllowBalancePayment: true,
  printingEnabled: false,
  instructionsEnabled: true,
  tasksEnabled: true,
  landingEnabled: true,
  goodsEnabled: true,
  clientsEnabled: true,
};

// Пример содержимого квитанции для живого превью (запрос пользователя 2026-07-20:
// "должно быть превью квитанции (шапка и футер) настраиваются") — те же
// данные и та же buildReceiptHtml(), что и у реальной печати, чтобы превью
// гарантированно не разъезжалось с тем, что реально напечатается.
function samplePrintData(t: ReturnType<typeof useI18n>): PrintDocumentData {
  return {
    title: t.settings.systemReceiptPreviewTitle,
    subtitle: `20.07.2026 · 14:32 · ${t.common.ownerLabel}`,
    sections: [
      {
        lines: [
          { label: t.settings.systemReceiptPreviewLine1, value: "1" },
          { label: t.settings.systemReceiptPreviewLine2, value: "500 ₽" },
        ],
      },
    ],
    totalLine: { label: t.settings.systemReceiptPreviewTotal, value: "500 ₽" },
  };
}

/**
 * Настройки → Система (запрос пользователя 2026-07-20) — глобальные
 * тумблеры Владельца, не привязанные к конкретному модулю по месту в меню.
 * Задумана расширяемой — новые тумблеры добавляются в rows ниже, без
 * переделки страницы.
 *
 * printingEnabled — только общий рубильник "печать вообще есть" для
 * модуля печати квитанций (НЕ фискальный чек). Сам выбор принтера сюда не
 * переедет — он физически привязан к устройству (USB/Bluetooth,
 * Web Bluetooth/WebUSB конкретного телефона/планшета Оператора) либо к
 * точке (WiFi-принтер по IP) — обсуждено с пользователем 2026-07-20.
 * Настройка "печатать квитанцию для этой зоны или нет" — по зонам
 * (/zones/[id]), не эта.
 */
export default function SystemSettingsPage() {
  const t = useI18n();
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [previewFrameHeight, setPreviewFrameHeight] = useState(384);
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULTS);
  const [tenantName, setTenantName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // Шапка квитанции — что показывать (запрос пользователя 2026-07-20:
  // "настройки Шапки чека: отображать логотип компании, название компании и
  // другое"). Сами лого/название не редактируются здесь — переиспользуют
  // уже существующие поля тенанта (Settings → Внешний вид/Лендинг).
  const [showLogo, setShowLogo] = useState(true);
  const [showTenantName, setShowTenantName] = useState(true);
  // Компактная шапка (запрос пользователя 2026-07-20) — лого слева, название
  // тенанта + заголовок документа рядом с ним, а не раскладка в столбик по
  // центру — короче по высоте, заметно на рулоне термопринтера.
  const [compactHeader, setCompactHeader] = useState(false);
  const [ownerHasPrinter, setOwnerHasPrinter] = useOwnerHasPrinterLocal();

  useEffect(() => {
    fetch("/api/tenant/system-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSettings((prev) => ({ ...prev, ...data }));
          setTenantName(data.tenantName ?? "");
          setLogoUrl(data.logoUrl ?? null);
          setShowLogo(data.receiptShowLogo ?? true);
          setShowTenantName(data.receiptShowTenantName ?? true);
          setCompactHeader(data.receiptCompactHeader ?? false);
        }
        setChecking(false);
      });
  }, []);

  function patch(partial: Partial<SystemSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    fetch("/api/tenant/system-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    }).then(() => {
      // Нав владельца (owner-shell.tsx) слушает это событие и сразу
      // перезапрашивает состав модулей — без него переключатель в "Модулях"
      // менялся мгновенно, а сам бар/сайдбар обновлялся только после
      // следующей полной перезагрузки страницы (запрос пользователя
      // 2026-07-22: "сразу должен обновляться интерфейс... владельца").
      window.dispatchEvent(new Event("tenant-modules-changed"));
    });
  }

  function patchHeaderToggle(partial: {
    receiptShowLogo?: boolean;
    receiptShowTenantName?: boolean;
    receiptCompactHeader?: boolean;
  }) {
    if (partial.receiptShowLogo !== undefined) setShowLogo(partial.receiptShowLogo);
    if (partial.receiptShowTenantName !== undefined) setShowTenantName(partial.receiptShowTenantName);
    if (partial.receiptCompactHeader !== undefined) setCompactHeader(partial.receiptCompactHeader);
    fetch("/api/tenant/system-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  const previewHtml = buildReceiptHtml(samplePrintData(t), {
    tenantName,
    logoUrl,
    showLogo,
    showTenantName,
    compactHeader,
  });

  const rows: Array<{ key: keyof SystemSettings; label: string; sub: string }> = [
    {
      key: "goodsAllowBalancePayment",
      label: t.settings.systemGoodsBalancePaymentLabel,
      sub: t.settings.systemGoodsBalancePaymentHint,
    },
    {
      key: "printingEnabled",
      label: t.settings.systemPrintingLabel,
      sub: t.settings.systemPrintingHint,
    },
  ];

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-md md:max-w-xl lg:max-w-2xl flex-col gap-1">
          <Link href="/settings" className="mb-2 w-fit text-body-airbnb font-semibold text-primary">
            ← {t.settings.title}
          </Link>
          <h1 className="mb-4 text-screen-title">{t.settings.systemTitle}</h1>

          <StaggerList className="flex flex-col gap-3">
            {/* "Модули" — первая плашка (запрос пользователя 2026-07-22),
                множественный выбор тем же визуальным паттерном, что
                CurrencyPicker, но без единственности выбора — любой набор
                тайлов сразу. Чисто упрощение интерфейса Владельца, не пакет/
                тариф (см. комментарий у полей в schema.prisma). */}
            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col gap-2">
                <span className="text-section-title">{t.settings.systemModulesTitle}</span>
                <p className="text-caption-airbnb">{t.settings.systemModulesHint}</p>
                {/* Адаптивная сетка (запрос пользователя 2026-07-22): 3 в ряд
                    на телефоне, все 6 в один ряд от sm и шире — тайлы не
                    фиксированного размера, а тянутся на ширину колонки
                    (aspect-square вместо size-18), иначе на 3-колоночной
                    сетке остались бы пустые промежутки. */}
                <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {MODULE_TILES.map((tile) => {
                    const Icon = tile.icon;
                    const selected = settings[tile.key];
                    return (
                      <button
                        key={tile.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => patch({ [tile.key]: !selected })}
                        className={cn(
                          "relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-control border p-1 text-center transition-colors",
                          selected ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30"
                        )}
                      >
                        {selected && (
                          <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                            <Check className="size-3" />
                          </span>
                        )}
                        <Icon className="size-5 text-foreground" />
                        <span className="text-[0.625rem] font-medium leading-tight text-muted-foreground">
                          {tile.label(t)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SpringCard>
            </StaggerItem>

            <StaggerItem>
              <SpringCard animate={false} hover={false} className="flex flex-col">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
                    <div className="min-w-0">
                      <div className="text-body-airbnb">{row.label}</div>
                      <div className="text-caption-airbnb">{row.sub}</div>
                    </div>
                    <Switch checked={settings[row.key]} onCheckedChange={(v) => patch({ [row.key]: v })} className="shrink-0" />
                  </div>
                ))}
              </SpringCard>
            </StaggerItem>

            {/* Блок "Квитанция" — показывается только пока сама печать
                включена выше (запрос пользователя 2026-07-20: настройка
                шапки/футера теряет смысл, если печати вообще нет). */}
            {settings.printingEnabled && (
              <StaggerItem>
                <SpringCard animate={false} hover={false} className="flex flex-col gap-4">
                  <h2 className="text-section-title">{t.settings.systemReceiptSectionTitle}</h2>

                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="min-w-0">
                      <div className="text-body-airbnb">{t.points.hasPrinterLabel}</div>
                      <div className="text-caption-airbnb">{t.settings.systemOwnerHasPrinterHint}</div>
                    </div>
                    <Switch checked={ownerHasPrinter} onCheckedChange={setOwnerHasPrinter} className="shrink-0" />
                  </div>

                  {/* Шапка — что показывать (запрос пользователя 2026-07-20).
                      Сами лого/название переиспользуют Tenant.logoUrl/name,
                      уже настраиваемые в другом месте — здесь только да/нет. */}
                  <div className="flex flex-col gap-1 border-t border-border pt-3">
                    <p className="text-caption-airbnb font-bold uppercase tracking-wider text-muted-foreground">
                      {t.settings.systemReceiptHeaderTitle}
                    </p>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-body-airbnb">{t.settings.systemReceiptShowLogoLabel}</span>
                      <Switch
                        checked={showLogo}
                        onCheckedChange={(v) => patchHeaderToggle({ receiptShowLogo: v })}
                        className="shrink-0"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-body-airbnb">{t.settings.systemReceiptShowNameLabel}</span>
                      <Switch
                        checked={showTenantName}
                        onCheckedChange={(v) => patchHeaderToggle({ receiptShowTenantName: v })}
                        className="shrink-0"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <span className="text-body-airbnb">{t.settings.systemReceiptCompactHeaderLabel}</span>
                        <p className="text-caption-airbnb text-muted-foreground">{t.settings.systemReceiptCompactHeaderHint}</p>
                      </div>
                      <Switch
                        checked={compactHeader}
                        onCheckedChange={(v) => patchHeaderToggle({ receiptCompactHeader: v })}
                        className="shrink-0"
                      />
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <p className="mb-2 text-caption-airbnb text-muted-foreground">{t.settings.systemReceiptPreviewLabel}</p>
                    {/* Фон рисует сам HTML внутри iframe (RECEIPT_CSS,
                        @media screen — светло-серая канва под белым
                        "листом" квитанции с рваным краем, запрос
                        пользователя 2026-07-20: "чтобы было понятно, что это
                        квитанция"), поэтому здесь без bg-white.
                        Высота iframe подгоняется под реальную высоту
                        контента (запрос пользователя 2026-07-20: "вертикальный
                        скролл в превью не нужен, пусть отображается
                        полностью") — фиксированная h-96 обрезала выросшую
                        от увеличенных шрифтов квитанцию скроллом внутри
                        рамки; onLoad стреляет заново при каждой смене
                        srcDoc (правка футера/тумблеров шапки). */}
                    <iframe
                      ref={previewFrameRef}
                      title={t.settings.systemReceiptPreviewLabel}
                      srcDoc={previewHtml}
                      scrolling="no"
                      style={{ height: previewFrameHeight }}
                      className="w-full rounded-control border border-border"
                      onLoad={() => {
                        const doc = previewFrameRef.current?.contentDocument;
                        if (doc) setPreviewFrameHeight(doc.documentElement.scrollHeight);
                      }}
                    />
                    {/* Тестовая печать — проверить весь путь window.print()
                        на реальном принтере, тем же стилем кнопки, что и
                        "Категории"/утилитарные действия по проекту (запрос
                        пользователя 2026-07-20). */}
                    <div className="mt-3 flex justify-center">
                      <PrintButton
                        label={t.settings.systemReceiptTestPrintButton}
                        data={samplePrintData(t)}
                        branding={{ tenantName, logoUrl, showLogo, showTenantName, compactHeader }}
                        className="gap-1.5 rounded-lg"
                      />
                    </div>
                  </div>
                </SpringCard>
              </StaggerItem>
            )}
          </StaggerList>
        </div>
      </div>
    </OwnerShell>
  );
}
