"use client";

import { useEffect, useState } from "react";
import { Banknote, ChevronLeft, CreditCard, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Money } from "@/components/money";
import { PhoneInput } from "@/components/phone-input";
import { useI18n } from "@/components/i18n-provider";

interface WalletCtx {
  id: string;
  phone: string;
  name: string | null;
  balance: number;
}

interface AbonementCtx {
  id: string;
  name: string | null;
  price: number;
  creditAmount: number;
}

interface AbonementPaymentSheetProps {
  open: boolean;
  onClose: () => void;
  // Сумма пуска, которую нужно списать — определяет, хватает ли баланса
  // найденного кошелька, и предлагает пополнение, если нет.
  amount: number;
  // Кошелёк готов и на нём хватает средств — родитель сам делает
  // фактическое списание (старт/стоп пуска или тап "Пусков" с
  // paymentMethod="abonement"+abonementWalletId), эта форма только находит/
  // создаёт/пополняет кошелёк.
  onConfirm: (walletId: string) => void;
}

/**
 * Общий sheet оплаты абонементом (запрос пользователя 2026-07-17) — один
 * компонент на "Прибывания" (старт "За вход", стоп "По факту") и "Пуски"
 * (тап): поиск по телефону → нашёлся с достаточным балансом → списание;
 * не нашёлся или не хватает — пополнение абонементом владельца прямо тут
 * ("оператор, прямо в момент оплаты"), без выхода из потока оплаты пуска.
 */
export function AbonementPaymentSheet({ open, onClose, amount, onConfirm }: AbonementPaymentSheetProps) {
  const t = useI18n();

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  // undefined — ещё не искали, null — искали, не нашли, объект — нашли.
  const [found, setFound] = useState<WalletCtx | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [plans, setPlans] = useState<AbonementCtx[] | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setPhone("");
      setFound(undefined);
      setName("");
      setPendingPlanId(null);
      setError(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function loadPlans() {
    if (plans) return;
    fetch("/api/operator/abonement-plans")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPlans(data?.plans ?? []));
  }

  function handleSearch() {
    if (!phone.trim() || searching) return;
    setSearching(true);
    setError(null);
    fetch(`/api/operator/abonements?phone=${encodeURIComponent(phone)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setFound(data.abonement);
        if (!data.abonement || data.abonement.balance < amount) loadPlans();
      })
      .catch(() => setError(t.operatorApp.gameRoom.networkError))
      .finally(() => setSearching(false));
  }

  async function handleCreate(abonementId: string, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/operator/abonements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() || undefined, abonementId, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingPlanId(null);
      if (data.balance >= amount) onConfirm(data.id);
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTopup(walletId: string, abonementId: string, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/abonements/${walletId}/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abonementId, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingPlanId(null);
      if (data.balance >= amount) onConfirm(data.id);
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  const pendingPlan = plans?.find((p) => p.id === pendingPlanId) ?? null;
  const isNew = found === null;
  const needsTopup = found !== undefined && found !== null && found.balance < amount;

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-3 pt-2">
        {pendingPlan ? (
          <>
            <button
              type="button"
              onClick={() => setPendingPlanId(null)}
              className="flex w-fit items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
            >
              <ChevronLeft className="size-3.5" />
              {t.common.back}
            </button>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.operatorApp.gameRoom.paymentMethodTitle}
            </h2>
            <p className="text-caption-airbnb text-muted-foreground">
              {pendingPlan.name ?? <Money value={pendingPlan.price} />} ·{" "}
              <Money value={pendingPlan.price} /> → <Money value={pendingPlan.creditAmount} />
            </p>
            <div className="flex flex-col gap-2">
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={submitting}
                onConfirm={() =>
                  isNew
                    ? handleCreate(pendingPlan.id, "cash")
                    : handleTopup(found!.id, pendingPlan.id, "cash")
                }
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={submitting}
                onConfirm={() =>
                  isNew
                    ? handleCreate(pendingPlan.id, "mobile")
                    : handleTopup(found!.id, pendingPlan.id, "mobile")
                }
              >
                <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.mobileLabel}
              </ConfirmButton>
            </div>
          </>
        ) : found === undefined ? (
          <>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.abonement.searchTitle}</h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="abonementPhone">{t.operatorApp.abonement.phoneLabel}</Label>
              <PhoneInput
                id="abonementPhone"
                autoFocus
                timezoneEndpoint="/api/operator/tenant-timezone"
                value={phone}
                onChange={setPhone}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                heightClassName="h-14"
              />
            </div>
            <PressableScale>
              <Button
                type="button"
                className="h-12 w-full font-bold"
                disabled={searching || !phone.trim()}
                onClick={handleSearch}
              >
                {searching ? t.operatorApp.abonement.searching : t.operatorApp.abonement.searchButton}
              </Button>
            </PressableScale>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setFound(undefined)}
              className="flex w-fit items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
            >
              <ChevronLeft className="size-3.5" />
              {t.common.back}
            </button>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {isNew ? t.operatorApp.abonement.newTitle : phone}
            </h2>

            {isNew && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="abonementName">{t.operatorApp.abonement.nameLabel}</Label>
                <Input
                  id="abonementName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 rounded-control bg-muted"
                />
              </div>
            )}

            {!isNew && found && (
              <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
                <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.abonement.balanceLabel}</span>
                <span className="text-xl font-extrabold tracking-[-0.02em]">
                  <Money value={found.balance} />
                </span>
              </div>
            )}

            {!isNew && found && !needsTopup && (
              <ConfirmButton
                variant="default"
                className="h-14 w-full gap-2 rounded-control font-bold"
                onConfirm={() => onConfirm(found.id)}
              >
                {t.operatorApp.abonement.spendButton} <Money value={amount} />
              </ConfirmButton>
            )}

            {(isNew || needsTopup) && (
              <>
                {needsTopup && (
                  <p className="text-caption-airbnb font-semibold text-warning">
                    {t.operatorApp.abonement.insufficientBalance} — {t.operatorApp.abonement.missingAmount}{" "}
                    <Money value={Math.round((amount - (found?.balance ?? 0)) * 100) / 100} />
                  </p>
                )}
                <p className="text-caption-airbnb font-semibold text-foreground">
                  {t.operatorApp.abonement.pickAbonementTitle}
                </p>
                {plans === null ? null : plans.length === 0 ? (
                  <p className="text-caption-airbnb text-destructive">{t.operatorApp.abonement.noAbonementsError}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {plans.map((plan) => (
                      <PressableScale key={plan.id}>
                        <Button
                          type="button"
                          variant="outline"
                          className="relative h-14 w-full justify-between pl-14 font-semibold"
                          disabled={isNew && !phone.trim()}
                          onClick={() => setPendingPlanId(plan.id)}
                        >
                          <Gift className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                          <span>{plan.name ?? <Money value={plan.price} />}</span>
                          <span className="tabular-nums">
                            <Money value={plan.price} /> → <Money value={plan.creditAmount} />
                          </span>
                        </Button>
                      </PressableScale>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </BottomSheet>
  );
}
