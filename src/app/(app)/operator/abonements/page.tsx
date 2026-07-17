"use client";

import { useEffect, useState } from "react";
import { AbonementTopupFlow } from "@/components/abonement-topup-flow";
import { useI18n } from "@/components/i18n-provider";

interface AbonementCtx {
  id: string;
  name: string | null;
  price: number;
  creditAmount: number;
}

/**
 * Экран "Абонементы" в PWA оператора (запрос пользователя 2026-07-17: "это
 * может делать как Владелец, так и Сотрудник") — точка входа из нижнего
 * бара, видна только когда у оператора есть доступная зона режима
 * "Прибывания"/"Пуски" (см. OperatorBottomNav — только там применяется
 * абонемент как способ оплаты). Продажа/пополнение кошелька клиента ВНЕ
 * момента оплаты конкретного пуска — точка неявная из сессии устройства,
 * поэтому AbonementTopupFlow тут без pointPicker, в отличие от кабинета
 * владельца.
 */
export default function OperatorAbonementsPage() {
  const t = useI18n();
  const [plans, setPlans] = useState<AbonementCtx[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/operator/abonement-plans")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPlans(data?.plans ?? []));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <h1 className="mb-4 text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.nav.abonements}</h1>
        <AbonementTopupFlow
          plans={plans}
          searchEndpoint="/api/operator/abonements"
          createEndpoint="/api/operator/abonements"
          topupEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/topup`}
          updateNameEndpointFor={(walletId) => `/api/operator/abonements/${walletId}`}
        />
      </div>
    </div>
  );
}
