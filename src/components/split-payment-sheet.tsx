"use client";

import { useEffect, useState } from "react";
import { Banknote, CreditCard, Trash2, Wallet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { MoneyInput } from "@/components/money-input";
import { Money } from "@/components/money";
import { useI18n } from "@/components/i18n-provider";
import { AbonementPaymentSheet } from "@/components/abonement-payment-sheet";
import { parseMoneyInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentLegInput } from "@/lib/payment-split";

type SplitMethod = "cash" | "mobile" | "abonement";

interface SplitLegDraft {
  method: SplitMethod;
  amount: string;
  walletId?: string;
  walletLabel?: string;
}

const METHOD_ICON: Record<SplitMethod, typeof Banknote> = {
  cash: Banknote,
  mobile: CreditCard,
  abonement: Wallet,
};

interface SplitPaymentSheetProps {
  open: boolean;
  onClose: () => void;
  // Итоговая сумма всей операции — сумма долей обязана совпасть с ней
  // (запрос пользователя 2026-07-26: "иногда люди хотят немного наличными,
  // часть безналом и часть балансом").
  total: number;
  allowedMethods: readonly SplitMethod[];
  // Кнопка "Баланс" в строке доли скрыта, если оплата балансом недоступна
  // тенанту вообще — тот же гейт, что уже проверяет сервер (clientsEnabled).
  clientsEnabled: boolean;
  submitting?: boolean;
  onSubmit: (legs: PaymentLegInput[]) => void | Promise<unknown>;
}

/**
 * Общий bottom sheet разбивки оплаты (запрос пользователя 2026-07-26) —
 * необязательное действие поверх обычных кнопок способа оплаты: 2-3 строки
 * {метод, сумма}, для строки "Баланс" — выбор кошелька через уже
 * существующий AbonementPaymentSheet (реальное списание случится один раз,
 * на сервере, при отправке всей разбивки — не здесь). Переиспользуется
 * Товарами/Билетами/Прибываниями/Счётчиками.
 */
export function SplitPaymentSheet({
  open,
  onClose,
  total,
  allowedMethods,
  clientsEnabled,
  submitting,
  onSubmit,
}: SplitPaymentSheetProps) {
  const t = useI18n();
  const METHOD_LABEL: Record<SplitMethod, string> = {
    cash: t.operatorApp.submit.cashLabel,
    mobile: t.operatorApp.submit.mobileLabel,
    abonement: t.operatorApp.abonement.paymentLabel,
  };
  const [legs, setLegs] = useState<SplitLegDraft[]>([
    { method: "cash", amount: "" },
    { method: "mobile", amount: "" },
  ]);
  const [walletTargetIndex, setWalletTargetIndex] = useState<number | null>(null);

  function update(index: number, patch: Partial<SplitLegDraft>) {
    setLegs((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function setMethod(index: number, method: SplitMethod) {
    // Смена метода сбрасывает выбранный кошелёк доли — он привязан к
    // конкретной сумме/строке, а не к методу вообще.
    update(index, { method, walletId: undefined, walletLabel: undefined });
  }

  // Сброс черновика при ЛЮБОМ закрытии, не только ручном (аудит 2026-07-26,
  // реальный баг) — вызывающие экраны при УСПЕШНОЙ отправке закрывают
  // шторку, меняя свой собственный target-стейт на null напрямую (не через
  // onClose), поэтому старый handleClose-only сброс не срабатывал: суммы,
  // методы и, что важнее, УЖЕ ВЫБРАННЫЙ КОШЕЛЁК абонемента переживали
  // закрытие и предзаполняли следующую, совершенно другую операцию — при
  // случайном совпадении суммы оператор мог списать деньги с ЧУЖОГО
  // кошелька, не заметив этого (лейбл доли обезличен — "Кошелёк выбран").
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setLegs([
        { method: "cash", amount: "" },
        { method: "mobile", amount: "" },
      ]);
      setWalletTargetIndex(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const parsedLegs = legs.map((l) => ({ ...l, parsedAmount: parseMoneyInput(l.amount) }));
  const sum = Math.round(parsedLegs.reduce((s, l) => s + l.parsedAmount, 0) * 100) / 100;
  const remaining = Math.round((total - sum) * 100) / 100;
  const abonementLegMissingWallet = legs.some((l) => l.method === "abonement" && !l.walletId);
  const hasDuplicateMethod = new Set(legs.map((l) => l.method)).size !== legs.length;
  const allPositive = parsedLegs.every((l) => l.parsedAmount > 0);
  const canSubmit =
    legs.length >= 2 && allPositive && !hasDuplicateMethod && remaining === 0 && !abonementLegMissingWallet;

  async function handleSubmit() {
    await onSubmit(
      parsedLegs.map((l) => ({ method: l.method, amount: l.parsedAmount, walletId: l.walletId }))
    );
  }

  const walletTarget = walletTargetIndex !== null ? legs[walletTargetIndex] : null;

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.splitPayment.title}</h2>
          <p className="text-caption-airbnb text-muted-foreground">
            {t.splitPayment.remainingLabel}{" "}
            <span className={cn("font-bold tabular-nums", remaining !== 0 ? "text-destructive" : "text-primary")}>
              <Money value={remaining} />
            </span>
          </p>

          <div className="flex flex-col gap-2">
            {legs.map((leg, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  {allowedMethods
                    .filter((m) => m !== "abonement" || clientsEnabled)
                    .map((m) => {
                      const Icon = METHOD_ICON[m];
                      const active = leg.method === m;
                      return (
                        <PressableScale key={m}>
                          <Button
                            type="button"
                            variant={active ? "default" : "outline"}
                            size="icon"
                            className="size-12"
                            onClick={() => setMethod(index, m)}
                          >
                            <Icon className="size-7" />
                          </Button>
                        </PressableScale>
                      );
                    })}
                  <span className="shrink-0 truncate text-sm font-semibold">{METHOD_LABEL[leg.method]}</span>
                  <MoneyInput
                    placeholder={t.splitPayment.amountPlaceholder}
                    value={leg.amount}
                    onChange={(e) => update(index, { amount: e.target.value })}
                    className="h-12"
                  />
                  {legs.length > 2 && (
                    <PressableScale>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-12"
                        aria-label={t.zoneDetail.gameRoomRemoveOptionLabel}
                        onClick={() => setLegs((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </PressableScale>
                  )}
                </div>
                {leg.method === "abonement" && (
                  <PressableScale className="w-fit">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setWalletTargetIndex(index)}
                    >
                      <Wallet className="size-3.5" />
                      {leg.walletLabel ?? t.splitPayment.selectWalletButton}
                    </Button>
                  </PressableScale>
                )}
              </div>
            ))}
          </div>

          {legs.length < 3 && (
            <PressableScale className="w-fit">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const used = new Set(legs.map((l) => l.method));
                  const next = allowedMethods.find((m) => !used.has(m)) ?? allowedMethods[0]!;
                  setLegs((prev) => [...prev, { method: next, amount: "" }]);
                }}
              >
                <Plus className="size-4" />
                {t.splitPayment.addMethodButton}
              </Button>
            </PressableScale>
          )}

          <ConfirmButton
            className="relative h-12 w-full font-semibold"
            disabled={!canSubmit || submitting}
            onConfirm={handleSubmit}
          >
            {t.splitPayment.submitButton}
          </ConfirmButton>
        </div>
      </BottomSheet>

      {/* Кошелёк выбирается для КОНКРЕТНОЙ доли, не для всей суммы —
          confirmLabel меняет подпись кнопки, т.к. реального списания здесь
          ещё не происходит (оно случится один раз при handleSubmit выше). */}
      <AbonementPaymentSheet
        open={walletTargetIndex !== null}
        onClose={() => setWalletTargetIndex(null)}
        amount={walletTarget ? parseMoneyInput(walletTarget.amount) : 0}
        confirmLabel={t.splitPayment.selectWalletButton}
        onConfirm={(walletId) => {
          if (walletTargetIndex === null) return;
          update(walletTargetIndex, { walletId, walletLabel: t.splitPayment.walletSelectedLabel });
          setWalletTargetIndex(null);
        }}
      />
    </>
  );
}
