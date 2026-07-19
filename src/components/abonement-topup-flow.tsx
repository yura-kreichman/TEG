"use client";

import { useState } from "react";
import { Banknote, Check, ChevronLeft, CreditCard, Gift, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { PhoneInput } from "@/components/phone-input";
import { useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n";

// Кнопки выбора (план/способ оплаты) должны читаться как кнопки, не как
// плоские карточки списка (запрос пользователя 2026-07-17: "должны быть как
// кнопки, с эффектом приподнимающимся") — стандартный variant="outline" даёт
// тень с альфой всего .05, на светлом градиентном фоне PWA почти незаметную;
// тут заметно плотнее и с более выраженным "утоплением" по нажатию, тот же
// принцип объёма, что у Switch/SaveButton по всему проекту. Второй раунд
// (запрос пользователя 2026-07-18: "должны больше приподниматься, быть более
// яркими") — тень ещё плотнее и шире (было alpha .10/.14, стало .16/.20).
const RAISED_OPTION_BUTTON_CLASS =
  "border-border bg-linear-to-b from-card to-muted/50 shadow-[0_3px_8px_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.85)] hover:shadow-[0_6px_16px_rgba(0,0,0,.20),inset_0_1px_0_rgba(255,255,255,.85)] active:shadow-[inset_0_3px_6px_rgba(0,0,0,.18)]";

interface WalletCtx {
  id: string;
  phone: string;
  name: string | null;
  balance: number;
  createdAt?: string;
}

// Дата создания в коротком локализованном виде + "стаж" одним числом+суффиксом
// (тот же приём инвариантного суффикса, что и у shiftsSuffix/hoursSuffix по
// всему проекту — без грамматически точного склонения по числам, запрос
// пользователя 2026-07-18: "дата создания абонента и стаж").
function formatCreatedDate(createdAt: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(createdAt)
  );
}
export function formatTenure(createdAt: string, t: Dictionary): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days < 1) return t.abonements.tenureToday;
  if (days < 30) return `${days} ${t.abonements.tenureDays}`;
  if (days < 365) return `${Math.floor(days / 30)} ${t.abonements.tenureMonths}`;
  return `${Math.floor(days / 365)} ${t.abonements.tenureYears}`;
}

interface AbonementCtx {
  id: string;
  name: string | null;
  price: number;
  creditAmount: number;
}

export interface AbonementTopupFlowProps {
  // Уже загруженный список планов — только когда allowPlanPurchase=true
  // (оператор, из /api/operator/abonement-plans).
  plans: AbonementCtx[];
  // Часовой пояс тенанта для read-only префикса телефона — разный эндпоинт
  // для владельца/оператора (см. PhoneInput) — компонент общий для обеих
  // ролей, поэтому не может знать это сам, обязателен явный проп (реальный
  // баг, найден пользователем 2026-07-19: было захардкожено на владельческий
  // /api/tenant/timezone, у оператора он отвечал 401, и префикс молча
  // откатывался на дефолт "RU +7" вместо реального часового пояса тенанта).
  timezoneEndpoint: string;
  // GET ?phone= — поиск кошелька.
  searchEndpoint: string;
  // POST — создание кошелька + первое пополнение.
  createEndpoint: string;
  // POST — пополнение существующего кошелька по его id.
  topupEndpointFor: (walletId: string) => string;
  // PATCH — правка имени уже существующего кошелька (запрос пользователя
  // 2026-07-17: "Сотрудник должен иметь возможность... менять имя, в том
  // числе у имеющихся"). Не передан — карандаш редактирования не
  // показывается (например, embedded-режим initialWallet в кабинете
  // владельца — там имя правится отдельным полем на самой странице).
  updateNameEndpointFor?: (walletId: string) => string;
  // Продажа плана (выбор из списка + оплата Наличные/Безнал, кассовая
  // операция) — только Сотрудник (запрос пользователя 2026-07-18: "Продаёт
  // только сотрудник"; Владелец физически не стоит на точке и не берёт
  // деньги). По умолчанию true (оператор); Владелец передаёт false — вся
  // секция выбора плана скрыта, доступно только произвольное пополнение.
  allowPlanPurchase?: boolean;
  // Пополнение на произвольную сумму — только владелец (запрос пользователя
  // 2026-07-17: "это родственник владельца или его друг... кинуть на
  // абонемент произвольную сумму"). С 2026-07-18 НЕ кассовая операция и не
  // привязана к точке (запрос пользователя: "нигде не должно учитываться") —
  // чистое изменение баланса кошелька, без следа в "Деньгах".
  allowArbitraryAmount?: boolean;
  // Произвольная сумма — тоже РЕАЛЬНАЯ оплата (запрос пользователя
  // 2026-07-19: Сотрудник принимает деньги на точке за призвольную сумму,
  // не только по фиксированному плану) — в отличие от Владельца (адрес
  // выше), тут перед зачислением нужен экран выбора способа оплаты, тот же,
  // что у покупки плана, и создаётся реальная MoneyOperation (см.
  // topUpWalletArbitrary/createWalletWithTopupArbitrary). Не передан —
  // поведение как раньше: мгновенное зачисление без следа в кассе (Владелец).
  arbitraryAmountNeedsPaymentMethod?: boolean;
  // Встроить сразу для уже известного кошелька, без шага поиска по телефону
  // (запрос пользователя 2026-07-17: "владелец должен иметь возможность
  // вручную пополнить баланс" прямо из карточки абонента, не выходя в
  // отдельный поиск заново) — используется в детальном sheet абонента в
  // кабинете владельца. При заданном initialWallet скрываются шаги поиска,
  // кнопка "назад" и повторный показ шапки/баланса (родитель их уже
  // показывает сам) — остаётся только выбор плана/произвольной суммы.
  initialWallet?: WalletCtx;
  onSuccess?: () => void;
}

/**
 * Продажа/пополнение абонемента ВНЕ момента оплаты пуска (запрос
 * пользователя 2026-07-17: "должна быть опция пополнять баланс абонемента",
 * "это может делать как Владелец, так и Сотрудник") — поиск по телефону →
 * нашёлся → пополнить один из планов; не нашёлся → создать (имя
 * необязательно) + сразу пополнить выбранным планом. Голый контент без
 * обёртки — используется и внутри BottomSheet (AbonementTopupSheet, кабинет
 * владельца), и напрямую на всю страницу (/operator/abonements, пункт
 * нижнего бара оператора).
 */
export function AbonementTopupFlow({
  plans,
  timezoneEndpoint,
  searchEndpoint,
  createEndpoint,
  topupEndpointFor,
  updateNameEndpointFor,
  allowPlanPurchase = true,
  allowArbitraryAmount,
  arbitraryAmountNeedsPaymentMethod,
  initialWallet,
  onSuccess,
}: AbonementTopupFlowProps) {
  const t = useI18n();
  const locale = useLocale();

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  // undefined — ещё не искали, null — искали, не нашли, объект — нашли.
  const [found, setFound] = useState<WalletCtx | null | undefined>(initialWallet ?? undefined);
  const [name, setName] = useState("");
  // Экран выбора способа оплаты — план ИЛИ произвольная сумма (когда
  // arbitraryAmountNeedsPaymentMethod), тот же экран для обоих (запрос
  // пользователя 2026-07-19: реальная оплата произвольной суммы Сотрудником
  // требует того же подтверждения способа оплаты, что и покупка плана).
  const [pendingAction, setPendingAction] = useState<{ kind: "plan"; plan: AbonementCtx } | { kind: "arbitrary"; amount: number } | null>(
    null
  );
  const [arbitraryAmount, setArbitraryAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Экран подтверждения после успешной оплаты (запрос пользователя
  // 2026-07-17: "неочень понятно, когда он выбирает Наличные или Безнал что
  // некая оплата прошла и абоненту зачислено на счёт") — без него сотрудник
  // возвращался прямо на тот же экран выбора плана с чуть другим числом
  // баланса, что было незаметно как явное подтверждение.
  const [justCredited, setJustCredited] = useState<{ amount: number; newBalance: number } | null>(null);

  // Правка имени уже существующего абонента (запрос пользователя
  // 2026-07-17: "Сотрудник должен иметь возможность... менять имя, в том
  // числе у имеющихся") — карандаш у заголовка, не отдельный экран.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Регистрация нового абонента БЕЗ покупки абонемента (запрос пользователя
  // 2026-07-18: "чтобы сотрудник мог завести нового абонента, но не
  // продавать сам абонимент — может человек потом захочет") — кнопка
  // "Сохранить" в одном ряду с полем имени, доступна ещё до выбора плана.
  const [savingNew, setSavingNew] = useState(false);
  const { saved: savedNew, pulse: pulseSavedNew } = useSavePulse();

  async function handleSaveNew() {
    if (!phone.trim() || savingNew) return;
    setSavingNew(true);
    setError(null);
    try {
      const res = await fetch(createEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      pulseSavedNew();
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance, createdAt: data.createdAt });
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSavingNew(false);
    }
  }

  async function saveName() {
    if (!found || !updateNameEndpointFor || savingName) return;
    setSavingName(true);
    setError(null);
    try {
      const res = await fetch(updateNameEndpointFor(found.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound((prev) => (prev ? { ...prev, name: data.name } : prev));
      setEditingName(false);
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSavingName(false);
    }
  }

  function handleSearch() {
    if (!phone.trim() || searching) return;
    setSearching(true);
    setError(null);
    fetch(`${searchEndpoint}?phone=${encodeURIComponent(phone)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setFound(data.abonement);
      })
      .catch(() => setError(t.operatorApp.gameRoom.networkError))
      .finally(() => setSearching(false));
  }

  async function handleCreate(plan: AbonementCtx, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(createEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() || undefined, abonementId: plan.id, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setPendingAction(null);
      setJustCredited({ amount: plan.creditAmount, newBalance: data.balance });
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTopup(walletId: string, plan: AbonementCtx, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(topupEndpointFor(walletId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abonementId: plan.id, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingAction(null);
      setJustCredited({ amount: plan.creditAmount, newBalance: data.balance });
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  // Произвольная сумма, ТРЕКАЕМАЯ (Сотрудник, реальная оплата, см.
  // arbitraryAmountNeedsPaymentMethod) — сиблинг handleCreate/handleTopup
  // выше, а не handleAdjust ниже (тот — untracked-путь Владельца).
  async function handleCreateArbitrary(amount: number, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(createEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() || undefined, amount, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setPendingAction(null);
      setJustCredited({ amount, newBalance: data.balance });
      setArbitraryAmount("");
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTopupArbitrary(walletId: string, amount: number, paymentMethod: "cash" | "mobile") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(topupEndpointFor(walletId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingAction(null);
      setJustCredited({ amount, newBalance: data.balance });
      setArbitraryAmount("");
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  // Untracked-путь Владельца (см. arbitraryAmountNeedsPaymentMethod выше) —
  // мгновенное зачисление, без способа оплаты, без следа в кассе.
  async function handleAdjust() {
    const amount = Number(arbitraryAmount);
    if (!Number.isFinite(amount) || amount <= 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isNew ? createEndpoint : topupEndpointFor(found!.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? { phone, name: name.trim() || undefined, amount } : { amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setJustCredited({ amount, newBalance: data.balance });
      setArbitraryAmount("");
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  // Клик по кнопке произвольной суммы — трекаемый режим уходит на экран
  // выбора способа оплаты (см. pendingAction), untracked режим (Владелец)
  // зачисляет сразу, как раньше.
  function handleArbitraryButtonClick() {
    if (submitting) return;
    if (arbitraryAmountNeedsPaymentMethod) {
      const amount = Number(arbitraryAmount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      setPendingAction({ kind: "arbitrary", amount });
      return;
    }
    handleAdjust();
  }

  const isNew = found === null;

  return (
    <div className="flex flex-col gap-3">
      {justCredited ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-8" />
          </div>
          <div>
            <p className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.abonements.paymentAcceptedTitle}
            </p>
            <p className="mt-1 text-body-airbnb text-muted-foreground">
              {t.abonements.creditedLabel} +<Money value={justCredited.amount} />
            </p>
          </div>
          <div className="flex w-full items-center justify-between rounded-control bg-muted p-3.5">
            <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.abonement.balanceLabel}</span>
            <span className="text-xl font-extrabold tracking-[-0.02em]">
              <Money value={justCredited.newBalance} />
            </span>
          </div>
          <PressableScale className="w-full">
            <Button
              type="button"
              className="h-12 w-full font-bold"
              onClick={() => {
                // Возврат в карточку клиента (запрос пользователя
                // 2026-07-19), а не заново на экран поиска по телефону —
                // found уже содержит обновлённый баланс (setFound внутри
                // handleCreate*/handleTopup* выше), просто закрываем экран
                // подтверждения.
                setJustCredited(null);
              }}
            >
              {t.abonements.doneButton}
            </Button>
          </PressableScale>
        </div>
      ) : pendingAction ? (
        <>
          <button
            type="button"
            onClick={() => setPendingAction(null)}
            className="flex w-fit items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {t.common.back}
          </button>
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {t.operatorApp.gameRoom.paymentMethodTitle}
          </h2>
          <p className="text-caption-airbnb text-muted-foreground">
            {pendingAction.kind === "plan" ? (
              <>
                {pendingAction.plan.name ?? <Money value={pendingAction.plan.price} />} ·{" "}
                <Money value={pendingAction.plan.price} /> → <Money value={pendingAction.plan.creditAmount} />
              </>
            ) : (
              <Money value={pendingAction.amount} />
            )}
          </p>
          <div className="flex flex-col gap-2">
            <ConfirmButton
              className={cn("relative h-12 w-full font-semibold", RAISED_OPTION_BUTTON_CLASS)}
              disabled={submitting}
              onConfirm={() =>
                pendingAction.kind === "plan"
                  ? isNew
                    ? handleCreate(pendingAction.plan, "cash")
                    : handleTopup(found!.id, pendingAction.plan, "cash")
                  : isNew
                    ? handleCreateArbitrary(pendingAction.amount, "cash")
                    : handleTopupArbitrary(found!.id, pendingAction.amount, "cash")
              }
            >
              <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.cashLabel}
            </ConfirmButton>
            <ConfirmButton
              className={cn("relative h-12 w-full font-semibold", RAISED_OPTION_BUTTON_CLASS)}
              disabled={submitting}
              onConfirm={() =>
                pendingAction.kind === "plan"
                  ? isNew
                    ? handleCreate(pendingAction.plan, "mobile")
                    : handleTopup(found!.id, pendingAction.plan, "mobile")
                  : isNew
                    ? handleCreateArbitrary(pendingAction.amount, "mobile")
                    : handleTopupArbitrary(found!.id, pendingAction.amount, "mobile")
              }
            >
              <CreditCard className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.mobileLabel}
            </ConfirmButton>
          </div>
        </>
      ) : found === undefined ? (
        <>
          {/* Без заголовка "Новый абонент" здесь (запрос пользователя
              2026-07-18: "убрать, так как новый создаётся только если не
              существует") — на этом шаге ещё даже не искали по телефону,
              неизвестно, новый абонент это или уже существующий. Без пикера
              точки тут же (запрос того же дня: "зачем ты у владельца
              спрашиваешь Точку при создании Клиента" — сам клиент/поиск по
              телефону не привязан к точке, пикер нужен только дальше, для
              выбора и оплаты плана, там и показывается). */}
          <div className="flex flex-col gap-1">
            <Label htmlFor="topupPhone">{t.operatorApp.abonement.phoneLabel}</Label>
            <PhoneInput
              id="topupPhone"
              autoFocus
              timezoneEndpoint={timezoneEndpoint}
              value={phone}
              onChange={setPhone}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              heightClassName="h-14"
            />
          </div>
          <PressableScale>
            <Button
              type="button"
              className="relative h-12 w-full pl-14 font-bold"
              disabled={searching || !phone.trim()}
              onClick={handleSearch}
            >
              {/* Иконка поиска, как на кнопках способа оплаты (запрос
                  пользователя 2026-07-18: "сиконка поиска, как на методах
                  оплаты") */}
              <Search className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {searching ? t.operatorApp.abonement.searching : t.operatorApp.abonement.searchButton}
            </Button>
          </PressableScale>
        </>
      ) : (
        <>
          {!initialWallet && (
            <>
              <button
                type="button"
                onClick={() => setFound(undefined)}
                className="flex w-fit items-center gap-1.5 text-caption-airbnb font-semibold text-muted-foreground"
              >
                <ChevronLeft className="size-3.5" />
                {t.common.back}
              </button>
              {!isNew && editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder={t.operatorApp.abonement.nameLabel}
                    className="h-10"
                  />
                  <PressableScale>
                    <Button type="button" size="sm" disabled={savingName} onClick={saveName}>
                      {t.common.save}
                    </Button>
                  </PressableScale>
                  <PressableScale>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingName(false)}>
                      {t.common.close}
                    </Button>
                  </PressableScale>
                </div>
              ) : (
                <div
                  className={cn(!isNew && "rounded-card border border-border bg-card p-4.5 shadow-card-rest")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
                          {isNew ? t.operatorApp.abonement.newTitle : found?.name || phone}
                        </h2>
                        {!isNew && updateNameEndpointFor && (
                          <button
                            type="button"
                            onClick={() => {
                              setNameDraft(found?.name ?? "");
                              setEditingName(true);
                            }}
                            className="shrink-0 text-muted-foreground"
                            aria-label={t.common.edit}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                      </div>
                      {/* Телефон вторичной строкой, когда есть имя — иначе он и так
                          заголовок (найдено пользователем 2026-07-17: "здесь даже не
                          пишется имя" — у существующего кошелька имя не показывалось
                          вообще, только телефон в заголовке). */}
                      {!isNew && found?.name && (
                        <p className="text-caption-airbnb text-muted-foreground">{phone}</p>
                      )}
                    </div>
                    {/* Баланс — сразу в шапке, крупными цифрами (запрос
                        пользователя 2026-07-18: "перенеси баланс выше, в одну
                        строку с именем"; раньше был отдельным блоком заметно
                        ниже). */}
                    {!isNew && found && (
                      <div className="shrink-0 text-right">
                        <p className="text-caption-airbnb text-muted-foreground">
                          {t.operatorApp.abonement.balanceLabel}
                        </p>
                        <p className="text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
                          <Money value={found.balance} />
                        </p>
                      </div>
                    )}
                  </div>
                  {/* Дата создания + "стаж" — разделительной линией под
                      именем/балансом, всё в одной плашке (запрос пользователя
                      2026-07-18). */}
                  {!isNew && found?.createdAt && (
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-caption-airbnb text-muted-foreground">
                      <span>
                        {t.abonements.createdLabel} {formatCreatedDate(found.createdAt, locale)}
                      </span>
                      <span>
                        {t.abonements.tenureLabel} {formatTenure(found.createdAt, t)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {isNew && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="topupName">{t.operatorApp.abonement.nameLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id="topupName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 flex-1 rounded-control bg-muted"
                />
                {/* Завести абонента без покупки плана прямо сейчас (запрос
                    пользователя 2026-07-18: "может человек потом захочет") —
                    отдельно от кнопок ниже, которые сразу списывают деньги за
                    конкретный план. */}
                <PressableScale>
                  <SaveButton
                    className="h-12 shrink-0 px-5"
                    saved={savedNew}
                    disabled={!phone.trim()}
                    onClick={handleSaveNew}
                  />
                </PressableScale>
              </div>
            </div>
          )}

          {/* Продажа плана — только Сотрудник (запрос пользователя
              2026-07-18: "Продаёт только сотрудник"), у Владельца секция
              целиком скрыта. */}
          {allowPlanPurchase && (
            <>
              <p className="text-caption-airbnb font-semibold text-foreground">
                {t.operatorApp.abonement.pickAbonementTitle}
              </p>
              {plans.length === 0 ? (
                <p className="text-caption-airbnb text-destructive">{t.operatorApp.abonement.noAbonementsError}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {plans.map((plan) => (
                    <PressableScale key={plan.id}>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "relative h-14 w-full justify-between pl-14 font-semibold",
                          RAISED_OPTION_BUTTON_CLASS
                        )}
                        disabled={isNew && !phone.trim()}
                        onClick={() => setPendingAction({ kind: "plan", plan })}
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

          {allowArbitraryAmount && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-caption-airbnb font-semibold text-foreground">{t.abonements.arbitraryAmountTitle}</p>
              <div className="flex gap-2">
                <MoneyInput
                  aria-label={t.abonements.arbitraryAmountTitle}
                  inputMode="numeric"
                  className="h-12 flex-1 bg-card"
                  value={arbitraryAmount}
                  onChange={(e) => setArbitraryAmount(e.target.value)}
                  disabled={isNew && !phone.trim()}
                />
                <PressableScale>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 shrink-0 font-semibold"
                    disabled={submitting || !arbitraryAmount.trim() || (isNew && !phone.trim())}
                    onClick={handleArbitraryButtonClick}
                  >
                    {t.abonements.arbitraryAmountButton}
                  </Button>
                </PressableScale>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
