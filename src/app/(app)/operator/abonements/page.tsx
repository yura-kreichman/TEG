"use client";

import { useEffect, useState } from "react";
import { AbonementTopupFlow, type SpendZoneCtx } from "@/components/abonement-topup-flow";
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
 * бара, видна только когда у оператора есть хоть одна зона (см.
 * OperatorBottomNav — абонемент применим на любом режиме учёта, с
 * 2026-07-20 включая "Счётчики"/"Только касса"). Продажа/пополнение
 * кошелька клиента ВНЕ момента оплаты конкретного пуска — точка неявная из
 * сессии устройства, поэтому AbonementTopupFlow тут без pointPicker, в
 * отличие от кабинета владельца. allowZoneSpend — оплата балансом на месте
 * для "Счётчиков"/"Только кассы" (запрос пользователя 2026-07-20: "как
 * сделать, чтобы клиенты могли оплатить балансом").
 */
export default function OperatorAbonementsPage() {
  const t = useI18n();
  const [plans, setPlans] = useState<AbonementCtx[]>([]);
  // undefined — ещё грузится, [] — загружено, но подходящих зон нет (запрос
  // пользователя 2026-07-20: кнопка "Списать с баланса" не должна
  // появляться вовсе без хотя бы одной зоны "Счётчики"/"Только касса" на
  // точке) — до ответа сервера кнопку показывать нельзя, поэтому undefined
  // тоже трактуется как "скрыть" в AbonementTopupFlow.
  const [spendZones, setSpendZones] = useState<SpendZoneCtx[] | undefined>(undefined);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/operator/abonement-plans")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPlans(data?.plans ?? []));
    fetch("/api/operator/counter-zones")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSpendZones(data?.zones ?? []));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0 px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-xl lg:max-w-2xl">
        <h1 className="mb-4 text-[1.5rem] font-extrabold tracking-[-0.02em]">{t.abonements.walletsTitle}</h1>
        <AbonementTopupFlow
          plans={plans}
          timezoneEndpoint="/api/operator/tenant-timezone"
          searchEndpoint="/api/operator/abonements"
          createEndpoint="/api/operator/abonements"
          topupEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/topup`}
          updateNameEndpointFor={(walletId) => `/api/operator/abonements/${walletId}`}
          allowArbitraryAmount
          arbitraryAmountNeedsPaymentMethod
          allowZoneSpend
          spendZones={spendZones}
          zoneSpendEndpointFor={(walletId) => `/api/operator/abonements/${walletId}/zone-spend`}
        />
      </div>
    </div>
  );
}
