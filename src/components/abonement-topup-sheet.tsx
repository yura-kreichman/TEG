"use client";

import { BottomSheet } from "@/components/motion/bottom-sheet";
import { AbonementTopupFlow, type AbonementTopupFlowProps } from "@/components/abonement-topup-flow";

interface AbonementTopupSheetProps extends AbonementTopupFlowProps {
  open: boolean;
  onClose: () => void;
}

/**
 * BottomSheet-обёртка над AbonementTopupFlow (кабинет владельца — кнопка
 * "Продать/пополнить абонемент"). key={open} размонтирует/пересоздаёт Flow
 * при каждом открытии — простой и надёжный способ сбросить его внутреннее
 * состояние (поиск/найденный кошелёк/выбранный план) без ручного useEffect.
 */
export function AbonementTopupSheet({ open, onClose, ...flowProps }: AbonementTopupSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="pt-2">
        <AbonementTopupFlow key={String(open)} {...flowProps} />
      </div>
    </BottomSheet>
  );
}
