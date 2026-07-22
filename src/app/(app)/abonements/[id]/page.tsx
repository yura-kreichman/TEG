"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { PrintButton } from "@/components/print/print-button";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
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

  async function loadWallet() {
    const res = await fetch(`/api/abonement-wallets/${params.id}`);
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
    loadWallet().then(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  // Выписка баланса (запрос пользователя 2026-07-20) — последние 10 операций
  // по кошельку, тот же порядок (desc по occurredAt), что и в истории на
  // экране (см. /api/abonement-wallets/[id] — orderBy occurredAt: "desc").
  function buildBalanceReceiptData(): PrintDocumentData {
    return {
      title: t.abonements.receiptTitle,
      // Имя крупнее обычного subtitle, телефон под ним (запрос пользователя
      // 2026-07-20) — без имени телефон и так уже primary, второй раз его
      // не дублируем.
      subtitle: wallet!.name ? { primary: wallet!.name, secondary: wallet!.phone } : wallet!.phone,
      sections: [
        {
          title: t.abonements.historyTitle,
          lines: wallet!.history.slice(0, 10).map((h) => ({
            label: `${new Date(h.occurredAt).toLocaleDateString(locale)} · ${historyTypeLabel(h)}`,
            value: `${h.type === "spend" ? "−" : "+"}${formatMoneyWithCurrency(h.amount, locale, currency)}`,
          })),
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
          <Link href="/abonements" className="w-fit text-body-airbnb font-semibold text-primary">
            ← {t.abonements.walletsTitle}
          </Link>

          <SpringCard hover={false} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <h1 className="min-w-0 truncate text-screen-title">{wallet.name || wallet.phone}</h1>
                <span className="shrink-0 text-caption-airbnb text-muted-foreground">
                  {t.abonements.tenureLabel} {formatTenure(wallet.createdAt, t)}
                </span>
              </div>
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-full border-border text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  aria-label={t.abonements.deleteWallet}
                >
                  <Trash2 className="size-4.5" />
                </Button>
              </PressableScale>
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
            <p className="mb-2 text-card-title">{t.abonements.historyTitle}</p>
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
                      <p className="text-body-airbnb font-semibold">
                        {historyTypeLabel(h)}
                        {h.planName ? ` · ${h.planName}` : ""}
                      </p>
                      <p className="text-caption-airbnb text-muted-foreground">
                        {new Date(h.occurredAt).toLocaleString()}
                        {h.pointName ? ` · ${h.pointName}` : ""}
                        {h.performedByOwner
                          ? ` · ${t.common.ownerLabel}`
                          : h.performedBy
                            ? ` · ${h.performedBy}`
                            : ""}
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
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={remove} deleted={deleted} />
          </PressableScale>
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
