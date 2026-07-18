"use client";

import { useState } from "react";
import { Banknote, Check, ChevronLeft, CreditCard, Gift, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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
function formatTenure(createdAt: string, t: Dictionary): string {
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

interface PointOption {
  id: string;
  name: string;
}

export interface AbonementTopupFlowProps {
  // Уже загруженный список планов (владелец — из /api/abonements, отфильтрован
  // родителем по выбранной точке; оператор — из /api/operator/abonement-plans,
  // уже отфильтрован сервером по точке сессии).
  plans: AbonementCtx[];
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
  // Доп. поля в тело create/topup-запросов — у владельца обязателен pointId
  // (сессия не привязана к одной точке устройства, в отличие от оператора).
  extraBody?: Record<string, unknown>;
  // Пикер точки — только когда он передан (владелец); у оператора точка
  // неявная из сессии, пикер не нужен.
  pointPicker?: {
    options: PointOption[];
    value: string | null;
    onChange: (id: string) => void;
  };
  // Пополнение на произвольную сумму, без плана и без кассы — только
  // владелец (запрос пользователя 2026-07-17: "это родственник владельца
  // или его друг... кинуть на абонемент произвольную сумму"; оператор может
  // только через план — "понятно, что его можно оплатить только наличными
  // или безналом").
  allowArbitraryAmount?: boolean;
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
  searchEndpoint,
  createEndpoint,
  topupEndpointFor,
  updateNameEndpointFor,
  extraBody,
  pointPicker,
  allowArbitraryAmount,
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
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
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
        body: JSON.stringify({ phone, name: name.trim() || undefined, ...extraBody }),
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
        body: JSON.stringify({ phone, name: name.trim() || undefined, abonementId: plan.id, paymentMethod, ...extraBody }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setPendingPlanId(null);
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
        body: JSON.stringify({ abonementId: plan.id, paymentMethod, ...extraBody }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingPlanId(null);
      setJustCredited({ amount: plan.creditAmount, newBalance: data.balance });
      onSuccess?.();
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdjust() {
    const amount = Number(arbitraryAmount);
    if (!Number.isFinite(amount) || amount <= 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isNew ? createEndpoint : topupEndpointFor(found!.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew ? { phone, name: name.trim() || undefined, amount, ...extraBody } : { amount, ...extraBody }
        ),
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

  const pendingPlan = plans.find((p) => p.id === pendingPlanId) ?? null;
  const isNew = found === null;
  const pointReady = !pointPicker || !!pointPicker.value;

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
                setJustCredited(null);
                if (!initialWallet) {
                  setFound(undefined);
                  setPhone("");
                  setName("");
                }
              }}
            >
              {t.abonements.doneButton}
            </Button>
          </PressableScale>
        </div>
      ) : pendingPlan ? (
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
              className={cn("relative h-12 w-full font-semibold", RAISED_OPTION_BUTTON_CLASS)}
              disabled={submitting}
              onConfirm={() =>
                isNew ? handleCreate(pendingPlan, "cash") : handleTopup(found!.id, pendingPlan, "cash")
              }
            >
              <Banknote className="absolute left-3 top-1/2 size-8 -translate-y-1/2" />
              {t.operatorApp.submit.cashLabel}
            </ConfirmButton>
            <ConfirmButton
              className={cn("relative h-12 w-full font-semibold", RAISED_OPTION_BUTTON_CLASS)}
              disabled={submitting}
              onConfirm={() =>
                isNew ? handleCreate(pendingPlan, "mobile") : handleTopup(found!.id, pendingPlan, "mobile")
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
              timezoneEndpoint="/api/tenant/timezone"
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

          {/* Пикер точки — только здесь, перед выбором плана (запрос
              пользователя 2026-07-18: клиент сам по себе не привязан к
              точке, точка нужна лишь чтобы отфильтровать доступные там
              планы и записать, в какую кассу пришли деньги). */}
          {pointPicker && (
            <div className="flex flex-col gap-1">
              <Label>{t.abonements.pointsLabel}</Label>
              <Select
                value={pointPicker.value ?? undefined}
                onValueChange={(v) => v && pointPicker.onChange(v)}
                items={pointPicker.options.map((p) => ({ value: p.id, label: p.name }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.abonements.pointsLabel} />
                </SelectTrigger>
                <SelectContent>
                  {pointPicker.options.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
                    disabled={(isNew && !phone.trim()) || !pointReady}
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

          {allowArbitraryAmount && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-caption-airbnb font-semibold text-foreground">{t.abonements.arbitraryAmountTitle}</p>
              <div className="flex gap-2">
                <MoneyInput
                  aria-label={t.abonements.arbitraryAmountTitle}
                  inputMode="numeric"
                  className="h-12 flex-1"
                  value={arbitraryAmount}
                  onChange={(e) => setArbitraryAmount(e.target.value)}
                  disabled={isNew && !phone.trim()}
                />
                <PressableScale>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 shrink-0 font-semibold"
                    disabled={submitting || !arbitraryAmount.trim() || !pointReady || (isNew && !phone.trim())}
                    onClick={handleAdjust}
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
