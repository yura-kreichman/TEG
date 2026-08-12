"use client";

import { useEffect, useState } from "react";
import { AbonementTopupFlow } from "@/components/abonement-topup-flow";
import { useI18n } from "@/components/i18n-provider";
import { useOperatorPrintAvailable } from "@/hooks/use-print";

interface AbonementCtx {
  id: string;
  name: string | null;
  price: number;
  creditAmount: number;
}

/**
 * Экран "Абонементы" в PWA оператора (запрос пользователя 2026-07-17: "это
 * может делать как Владелец, так и Сотрудник") — точка входа из нижнего
 * бара, видна только когда у оператора есть хоть одна зона (см.
 * OperatorBottomNav — абонемент применим на любом режиме учёта, с
 * 2026-07-20 включая "Счётчики"/"Только касса"). Продажа/пополнение
 * кошелька клиента ВНЕ момента оплаты конкретного пуска — точка неявная из
 * сессии устройства, поэтому AbonementTopupFlow тут без pointPicker, в
 * отличие от кабинета владельца.
 *
 * Списание с баланса на месте ("Счётчики"/"Только касса") больше НЕ здесь
 * (запрос пользователя 2026-07-24: "немного не единообразный интерфейс...
 * надо запоминать, что если по Счётчикам, то заходить в Клиенты") —
 * переехало в отдельный пункт нижнего бара "Счётчики"
 * (/operator/counters), единственный путь для этого действия, дублей нет.
 * Этот экран остался единообразным для любого режима учёта: поиск/создание
 * клиента, пополнение, печать выписки.
 */
export default function OperatorAbonementsPage() {
  const t = useI18n();
  const [plans, setPlans] = useState<AbonementCtx[]>([]);
  const printAvailable = useOperatorPrintAvailable();

  useEffect(() => {
    fetch("/api/operator/abonement-plans")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPlans(data?.plans ?? []));
  }, []);

  return (
    <div className="flex flex-1 flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-xl lg:max-w-2xl">
        <h1 className="mb-4 text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.abonements.walletsTitle}</h1>
        <AbonementTopupFlow
          plans={plans}
          searchEndpoint="/api/operator/abonements"
          createEndpoint="/api/operator/abonements"
          topupEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/topup`}
          updateNameEndpointFor={(walletId) => `/api/operator/abonements/${walletId}`}
          allowArbitraryAmount
          arbitraryAmountNeedsPaymentMethod
          printAvailable={printAvailable.available}
          printBranding={printAvailable.branding}
          toastErrors
        />
      </div>
    </div>
  );
}
