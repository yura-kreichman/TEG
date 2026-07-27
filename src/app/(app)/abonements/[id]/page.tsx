"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, QrCode as QrCodeIcon, Trash2 } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Money } from "@/components/money";
import { PhoneInput } from "@/components/phone-input";
import { AbonementTopupFlow, formatTenure } from "@/components/abonement-topup-flow";
import { PerformedByTag } from "@/components/performed-by-tag";
import { PrintButton } from "@/components/print/print-button";
import { InstructionQrSheet } from "@/components/instructions/instruction-qr-sheet";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { formatPeriodLabel as formatPeriodLabelFor, isCurrentPeriod as isCurrentPeriodFor, periodRange, steppedAnchor, tenantTodayAnchor } from "@/lib/period-nav";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useTenantTimezone } from "@/hooks/use-tenant-timezone";
import { useOwnerPrintAvailable } from "@/hooks/use-print";
import type { PrintDocumentData } from "@/lib/print/receipt-document";
import { formatMoneyWithCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface WalletHistoryEntry {
  id: string;
  type: string;
  amount: number;
  occurredAt: string;
  planName: string | null;
  // "За что" списание/возврат (запрос пользователя 2026-07-24: "не просто
  // Списание, а за что именно").
  description: string | null;
  // Количество (запрос пользователя 2026-07-24: "в Печатную сводку и везде
  // должно быть указано количество") — только у "Счётчиков"-строк с тарифом.
  quantity: number | null;
  paymentMethod: string | null;
  pointName: string | null;
  performedBy: string | null;
  performedByOwner: boolean;
}

interface WalletDetail {
  id: string;
  phone: string;
  name: string | null;
  balance: number;
  createdAt: string;
  history: WalletHistoryEntry[];
  telegramBalanceLink: string | null;
  hasTelegram: boolean;
  showPointName: boolean;
}

/**
 * Отдельная страница абонента (запрос пользователя 2026-07-17: "стоит
 * сделать 'вход' в абонента и там управлять его настройками, пополнениями и
 * др.") — раньше всё это (правка имени/телефона, продажа/пополнение с
 * пикером точки и списком планов, произвольная сумма, полная история) было
 * впихнуто в один BottomSheet поверх списка "Абоненты" и криво отображалось
 * при таком объёме контента; теперь обычная страница с прокруткой, тот же
 * паттерн, что /operators/[id].
 */
export default function AbonementWalletPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const printAvailable = useOwnerPrintAvailable();

  const [checking, setChecking] = useState(true);
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const { saved, pulse } = useSavePulse();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { saved: deleted, pulse: deletePulse } = useSavePulse();
  const [qrOpen, setQrOpen] = useState(false);

  // Переключатель месяцев в истории операций (запрос пользователя
  // 2026-07-24: "слишком большой список будет") — тот же приём, что у
  // /operators/[id] (period-nav.ts), только без переключателя неделя/месяц —
  // тут явно просили именно "переключатель месяцев".
  // timezone тенанта, не UTC/браузера (аудит 2026-07-27, второй раунд) — см.
  // use-tenant-timezone.ts.
  const timezone = useTenantTimezone();
  const [anchor, setAnchor] = useState(() => tenantTodayAnchor(timezone));

  async function loadWallet(currentAnchor?: Date) {
    const { from, to } = periodRange("month", currentAnchor ?? anchor);
    const res = await fetch(`/api/abonement-wallets/${params.id}?from=${from}&to=${to}`);
    if (res.status === 403) {
      router.replace("/");
      return;
    }
    if (res.status === 404) {
      router.replace("/abonements");
      return;
    }
    const data = await res.json();
    setWallet(data);
    setForm({ name: data.name ?? "", phone: data.phone });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadWallet(anchor).then(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, anchor]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function stepPeriod(delta: number) {
    setAnchor((prev) => steppedAnchor("month", prev, delta));
  }
  function formatPeriodLabel() {
    return formatPeriodLabelFor("month", anchor, t);
  }
  function isCurrentPeriod() {
    return isCurrentPeriodFor("month", anchor, timezone);
  }

  async function save() {
    if (!wallet) return;
    setError(null);
    const res = await fetch(`/api/abonement-wallets/${wallet.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name.trim() || null, phone: form.phone }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Не удалось сохранить");
      return;
    }
    await loadWallet();
    pulse();
  }

  async function remove() {
    if (!wallet) return;
    await fetch(`/api/abonement-wallets/${wallet.id}`, { method: "DELETE" });
    deletePulse(() => router.push("/abonements"));
  }

  function historyTypeLabel(h: WalletHistoryEntry): string {
    return h.type === "topup"
      ? t.abonements.historyTopup
      : h.type === "spend"
        ? t.abonements.historySpend
        : h.type === "refund"
          ? t.abonements.historyRefund
          : t.abonements.historyAdjustment;
  }

  // Итоговая строка операции — запрос пользователя 2026-07-24: "убери
  // везде слово 'Списание', это итак понятно, ведь число с минусом". Слово
  // "Пополнение"/"Возврат"/"Корректировка" оставляем — у одинакового плюса
  // разный смысл (реальное поступление vs возврат вычета), знаком не
  // различить, а "Списание" при известном источнике (зона/товар/билеты) —
  // чистая тавтология с минусом рядом.
  function historyLabel(h: WalletHistoryEntry): string {
    const base = h.planName ?? h.description;
    // Количество (запрос пользователя 2026-07-24) — только у "Счётчиков".
    const detail = base && h.quantity ? `${base} × ${h.quantity}` : base;
    if (h.type === "spend") return detail ?? historyTypeLabel(h);
    return detail ? `${historyTypeLabel(h)} · ${detail}` : historyTypeLabel(h);
  }

  // Выписка баланса (запрос пользователя 2026-07-20) — операции ЗА
  // ПРОСМОТРЕННЫЙ МЕСЯЦ (переключатель месяцев, запрос пользователя
  // 2026-07-24), тот же порядок (desc по occurredAt), что сейчас на
  // экране, но не более 20 последних (запрос того же дня) — сам экран
  // по-прежнему показывает весь месяц целиком, это ограничение только для
  // печати (длинный месяц на A4 и так уже показал реальный баг с разрывом
  // страниц, см. комментарий у receipt-document.ts).
  function buildBalanceReceiptData(): PrintDocumentData {
    return {
      title: `${t.abonements.receiptTitle} · ${formatPeriodLabel()}`,
      // Имя крупнее обычного subtitle, телефон под ним (запрос пользователя
      // 2026-07-20) — без имени телефон и так уже primary, второй раз его
      // не дублируем.
      subtitle: wallet!.name ? { primary: wallet!.name, secondary: wallet!.phone } : wallet!.phone,
      sections: [
        {
          title: t.abonements.historyTitle,
          lines: wallet!.history.slice(0, 20).map((h) => {
            const when = new Date(h.occurredAt);
            const shortDate = when.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
            const shortTime = when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
            return {
              label: `${shortDate} ${shortTime} · ${historyLabel(h)}`,
              value: `${h.type === "spend" ? "−" : "+"}${formatMoneyWithCurrency(h.amount, locale, currency)}`,
            };
          }),
        },
      ],
      totalLine: { label: t.abonements.balanceLabel, value: formatMoneyWithCurrency(wallet!.balance, locale, currency) },
    };
  }

  if (checking || !wallet) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <BackLink label={t.abonements.walletsTitle} href="/abonements" />

          <SpringCard hover={false} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <h1 className="min-w-0 truncate text-screen-title">{wallet.name || wallet.phone}</h1>
                <span className="shrink-0 text-caption-airbnb text-muted-foreground">
                  {t.abonements.tenureLabel} {formatTenure(wallet.createdAt, t)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* Клиент сам проверяет баланс в Telegram (запрос пользователя
                    2026-07-22) — бот подтверждает личность номером через
                    request_contact, не показывается, если Владелец ещё не
                    подключил бота (telegramBalanceLink тогда null), а также если
                    клиент уже привязал чат сам — показывать QR ему заново
                    незачем (запрос пользователя 2026-07-23). Перенесена в один
                    ряд с заголовком, рядом с удалением (запрос пользователя
                    2026-07-25) — раньше была отдельной кнопкой ниже, у "Печать
                    выписки". */}
                {wallet.telegramBalanceLink && !wallet.hasTelegram && (
                  <PressableScale>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-lg"
                      aria-label={t.abonements.telegramBalanceButton}
                      onClick={() => setQrOpen(true)}
                    >
                      <QrCodeIcon className="size-4.5" />
                    </Button>
                  </PressableScale>
                )}
                <PressableScale>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 rounded-lg border-border text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    aria-label={t.abonements.deleteWallet}
                  >
                    <Trash2 className="size-4.5" />
                  </Button>
                </PressableScale>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="wPhone">{t.abonements.phoneLabel}</Label>
              <PhoneInput
                id="wPhone"
                timezoneEndpoint="/api/tenant/timezone"
                value={form.phone}
                onChange={(phone) => setForm((p) => ({ ...p, phone }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wName">{t.abonements.nameLabel}</Label>
              <Input id="wName" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
              <span className="text-caption-airbnb text-muted-foreground">{t.abonements.balanceLabel}</span>
              <span className="text-xl font-extrabold tracking-[-0.02em]">
                <Money value={wallet.balance} />
              </span>
            </div>
            {/* Выписка баланса (запрос пользователя 2026-07-20) — печать по
                требованию, кнопка видна только если у Владельца на этом
                браузере/устройстве отмечен принтер (useOwnerPrintAvailable). */}
            {printAvailable.available && (
              <PrintButton
                label={t.abonements.printReceiptButton}
                data={buildBalanceReceiptData()}
                branding={printAvailable.branding}
                printMethod={printAvailable.printMethod}
                className="w-full gap-1.5 rounded-lg"
              />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <PressableScale>
              <SaveButton type="button" className="h-12 w-full" saved={saved} onClick={save} />
            </PressableScale>
          </SpringCard>

          <SpringCard hover={false}>
            <p className="mb-2 text-card-title">{t.abonements.topupSheetTitle}</p>
            <AbonementTopupFlow
              key={wallet.id}
              initialWallet={{ id: wallet.id, phone: wallet.phone, name: wallet.name, balance: wallet.balance }}
              plans={[]}
              timezoneEndpoint="/api/tenant/timezone"
              searchEndpoint="/api/abonement-wallets"
              createEndpoint="/api/abonement-wallets"
              topupEndpointFor={(walletId) => `/api/abonement-wallets/${walletId}/topup`}
              allowPlanPurchase={false}
              allowArbitraryAmount
              onSuccess={loadWallet}
            />
          </SpringCard>

          <SpringCard hover={false}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-card-title">{t.abonements.historyTitle}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t.money.prevPeriod}
                  onClick={() => stepPeriod(-1)}
                  className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                >
                  <ChevronLeft className="size-4.5" />
                </button>
                <p className="w-28 text-center text-caption-airbnb font-semibold text-foreground">
                  {formatPeriodLabel()}
                </p>
                <button
                  type="button"
                  aria-label={t.money.nextPeriod}
                  onClick={() => stepPeriod(1)}
                  disabled={isCurrentPeriod()}
                  className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                >
                  <ChevronRight className="size-4.5" />
                </button>
              </div>
            </div>
            {wallet.history.length === 0 ? (
              <p className="text-caption-airbnb text-muted-foreground">{t.abonements.noHistory}</p>
            ) : (
              <div className="flex flex-col">
                {wallet.history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between gap-2 border-t border-border py-2.5 first:border-t-0"
                  >
                    <div className="min-w-0">
                      <p className="text-body-airbnb font-semibold">{historyLabel(h)}</p>
                      <p className="flex flex-wrap items-center gap-x-1 text-caption-airbnb text-muted-foreground">
                        <span>
                          {/* Короткий формат — день.месяц ЧЧ:ММ, без года и
                              секунд (запрос пользователя 2026-07-25) — тот
                              же приём, что уже в печатной выписке ниже
                              (formatPrintDocument), только теперь и на
                              самом экране, не только на бумаге. */}
                          {new Date(h.occurredAt).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}{" "}
                          {new Date(h.occurredAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                          {wallet.showPointName && h.pointName ? ` · ${h.pointName}` : ""}
                        </span>
                        {(h.performedByOwner || h.performedBy) && (
                          <>
                            <span>·</span>
                            <PerformedByTag name={h.performedBy} isOwner={h.performedByOwner} avatarUrl={null} iconKey={null} />
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums font-semibold",
                        h.type === "spend" ? "text-destructive" : "text-success"
                      )}
                    >
                      {h.type === "spend" ? "−" : "+"}
                      <Money value={h.amount} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SpringCard>
        </div>
      </div>

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.abonements.deleteWallet}</h2>
          <p className="text-body-airbnb">{t.abonements.confirmDeleteWallet}</p>
          {wallet.balance !== 0 && (
            <p className="flex items-center gap-1.5 text-body-airbnb font-semibold text-destructive">
              {t.abonements.confirmDeleteWalletBalanceWarning} <Money value={wallet.balance} />
            </p>
          )}
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={remove} deleted={deleted} />
          </PressableScale>
        </div>
      </BottomSheet>

      {wallet.telegramBalanceLink && (
        <InstructionQrSheet
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          title={t.abonements.telegramConnectSheetTitle}
          url={wallet.telegramBalanceLink}
        />
      )}
    </OwnerShell>
  );
}
