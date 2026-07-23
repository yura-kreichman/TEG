"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, ChevronLeft, CreditCard, Gift, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Label } from "@/components/ui/label";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Money } from "@/components/money";
import { PhoneInput } from "@/components/phone-input";
import { useI18n } from "@/components/i18n-provider";
import { playErrorChime } from "@/lib/beep";

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
  onConfirm: (walletId: string) => void | Promise<unknown>;
  /** true только у вызывающих экранов, что уже играют свой звук
   * подтверждения (Пуски/Прибывания) — этот же sheet используется и в
   * Товарах, где своего звука нет, там должен звучать общий "дзинь" (запрос
   * пользователя 2026-07-20). */
  silent?: boolean;
}

/**
 * Общий sheet оплаты абонементом (запрос пользователя 2026-07-17) — один
 * компонент на "Прибывания" (старт "За вход", стоп "По факту") и "Пуски"
 * (тап): поиск по телефону → нашёлся с достаточным балансом → списание;
 * не нашёлся или не хватает — пополнение абонементом владельца прямо тут
 * ("оператор, прямо в момент оплаты"), без выхода из потока оплаты пуска.
 */
export function AbonementPaymentSheet({ open, onClose, amount, onConfirm, silent }: AbonementPaymentSheetProps) {
  const t = useI18n();

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  // undefined — ещё не искали, объект — нашли. "Не нашли" здесь не отдельное
  // состояние found — это всплывающий тост (см. flashSearchError ниже), а не
  // ветка "создать нового клиента" (запрос пользователя 2026-07-22: при
  // оплате балансом ненайденный клиент не должен создаваться — нечего
  // списывать, оператор просто выбирает другой способ оплаты; создание
  // нового клиента остаётся только в разделе Клиенты).
  const [found, setFound] = useState<WalletCtx | undefined>(undefined);
  const [plans, setPlans] = useState<AbonementCtx[] | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // "Клиент не найден" — тот же самогаснущий тост, что "Заказ не найден" в
  // Билетах (запрос пользователя 2026-07-22) — здесь НЕ предлагаем создать
  // нового клиента при оплате балансом: не найден — нет баланса списывать,
  // оператор просто выбирает другой способ оплаты. Создание нового клиента
  // остаётся только в разделе Клиенты (там это и есть цель экрана).
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setPhone("");
      setFound(undefined);
      setPendingPlanId(null);
      setError(null);
      setSearchError(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(
    () => () => {
      if (searchErrorTimerRef.current) clearTimeout(searchErrorTimerRef.current);
    },
    []
  );

  function flashSearchError(message: string) {
    playErrorChime();
    setSearchError(message);
    setPhone("");
    if (searchErrorTimerRef.current) clearTimeout(searchErrorTimerRef.current);
    searchErrorTimerRef.current = setTimeout(() => setSearchError(null), 2500);
  }

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
        if (!data.abonement) {
          flashSearchError(t.operatorApp.abonement.clientNotFoundLabel);
          return;
        }
        setFound(data.abonement);
        if (data.abonement.balance < amount) loadPlans();
      })
      .catch(() => setError(t.operatorApp.gameRoom.networkError))
      .finally(() => setSearching(false));
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
  const needsTopup = found !== undefined && found.balance < amount;

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
                silent={silent}
                onConfirm={() => handleTopup(found!.id, pendingPlan.id, "cash")}
              >
                <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.cashLabel}
              </ConfirmButton>
              <ConfirmButton
                className="relative h-12 w-full font-semibold"
                disabled={submitting}
                silent={silent}
                onConfirm={() => handleTopup(found!.id, pendingPlan.id, "mobile")}
              >
                <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {t.operatorApp.submit.mobileLabel}
              </ConfirmButton>
            </div>
          </>
        ) : found === undefined ? (
          <div className="relative flex flex-col gap-3">
            {/* "Клиент не найден" — тот же самогаснущий тост, что "Заказ не
                найден" в Билетах (запрос пользователя 2026-07-22). */}
            <AnimatePresence>
              {searchError && (
                <motion.div
                  key="client-search-error-toast"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{
                    scale: { type: "spring", stiffness: 500, damping: 14 },
                    opacity: { duration: 0.15 },
                  }}
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                >
                  <div className="flex flex-col items-center gap-1.5 rounded-card bg-destructive px-5 py-3 text-center text-white shadow-floating">
                    <TriangleAlert className="size-9" />
                    <span className="text-lg font-extrabold">{searchError}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
                sizeClassName="text-2xl font-extrabold tabular-nums"
              />
            </div>
            <PressableScale>
              <Button
                type="button"
                className="relative h-12 w-full pl-14 font-bold"
                disabled={searching || !phone.trim()}
                onClick={handleSearch}
              >
                <Search className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
                {searching ? t.operatorApp.abonement.searching : t.operatorApp.abonement.searchOnlyButton}
              </Button>
            </PressableScale>
          </div>
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
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{found.name || phone}</h2>
            {/* Телефон вторичной строкой, когда есть имя (тот же приём, что
                в Клиентах, abonement-topup-flow.tsx) — иначе он и так
                заголовок. */}
            {found.name && <p className="text-caption-airbnb text-muted-foreground">{phone}</p>}

            <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
              <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.abonement.balanceLabel}</span>
              <span className="text-xl font-extrabold tracking-[-0.02em]">
                <Money value={found.balance} />
              </span>
            </div>

            {!needsTopup && (
              <ConfirmButton
                variant="default"
                className="h-14 w-full gap-2 rounded-control font-bold"
                onConfirm={() => onConfirm(found.id)}
              >
                {t.operatorApp.abonement.spendButton} <Money value={amount} />
              </ConfirmButton>
            )}

            {needsTopup && (
              <>
                <p className="text-caption-airbnb font-semibold text-warning">
                  {t.operatorApp.abonement.insufficientBalance} — {t.operatorApp.abonement.missingAmount}{" "}
                  <Money value={Math.round((amount - found.balance) * 100) / 100} />
                </p>
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
