"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowBigRight, Banknote, Check, CreditCard, Delete, Gift, MapPin, Minus, Pencil, Plus, QrCode, Search, Send, Trash2, TriangleAlert, Wallet } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { InstructionQrSheet } from "@/components/instructions/instruction-qr-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { PhoneInput } from "@/components/phone-input";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { PrintButton } from "@/components/print/print-button";
import { ActionToast } from "@/components/action-toast";
import { useCurrency, useI18n, useLocale } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { useActionToast } from "@/hooks/use-action-toast";
import { playErrorChime } from "@/lib/beep";
import { cn } from "@/lib/utils";
import { formatMoneyWithCurrency, parseMoneyInput } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { PrintDocumentData, ReceiptBranding } from "@/lib/print/receipt-document";

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

interface WalletHistoryEntry {
  type: string;
  amount: number;
  occurredAt: string;
  planName: string | null;
  // "За что" списание/возврат — зона (Пуски/Прибывания/Счётчики), товар или
  // билеты (запрос пользователя 2026-07-24: "не просто Списание, а за что
  // именно"); null у "adjustment" (untracked-корректировка) — там сказать
  // нечего.
  description: string | null;
  // Количество (запрос пользователя 2026-07-24: "Сотрудник мог списывать
  // сразу несколько тарифов" + "в Печатную сводку и везде должно быть
  // указано количество") — только у "Счётчиков"-строк с тарифом.
  quantity: number | null;
}

interface WalletCtx {
  id: string;
  phone: string;
  name: string | null;
  balance: number;
  createdAt?: string;
  // Только для Выписки баланса (модуль печати, запрос пользователя
  // 2026-07-20) — последние 10 операций, приходят только из операторского
  // /api/operator/abonements (Владелец печатает выписку со своей отдельной
  // страницы /abonements/[id], не через этот компонент).
  history?: WalletHistoryEntry[];
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
  // Оплата балансом на месте (не пополнение, списание) — только Сотрудник,
  // для зон без Launch-учёта: "Счётчики" (выбор актив+тариф) и "Только
  // касса" (сама зона, активов нет) — docs/spec/01-counters.md, запрос
  // пользователя 2026-07-20: "как сделать, чтобы клиенты могли оплатить
  // балансом". Не передан — секция целиком скрыта (Владелец физически не
  // стоит на точке и не принимает оплату). spendZones — уже загруженный
  // страницей список (не сам компонент грузит лениво по тапу) — кнопка
  // "Списать с баланса" не должна появляться вовсе, если у оператора на
  // точке нет ни одной подходящей зоны (запрос пользователя 2026-07-20:
  // "если... нет Зон с режимом учёта... эта кнопка не должна отображаться"),
  // а до ответа сервера решить это нельзя.
  allowZoneSpend?: boolean;
  spendZones?: SpendZoneCtx[] | null;
  zoneSpendEndpointFor?: (walletId: string) => string;
  // Печать выписки баланса (модуль печати, запрос пользователя 2026-07-20) —
  // не передано (Владелец, /abonements/[id] уже рисует свою кнопку печати
  // сама на странице, с полной историей за всё время) — кнопка здесь просто
  // не появляется, дублей нет. Передано (Оператор, /operator/abonements) —
  // источник доступности/брендинга разный для ролей (useOwnerPrintAvailable
  // vs useOperatorPrintAvailable, разные API), поэтому решается снаружи, не
  // внутри этого общего компонента.
  printAvailable?: boolean;
  printBranding?: ReceiptBranding;
  // Пункт нижнего бара "Счётчики" (запрос пользователя 2026-07-24) —
  // Сотрудник ищет клиента и сразу попадает на списание, без промежуточной
  // карточки клиента (пополнение/печать/смена имени — там не нужны, это
  // задачи экрана "Клиенты") и БЕЗ создания нового клиента ("в этом пункте
  // меню нового добавить нельзя" — решение того же дня; не нашли — просто
  // сообщение, завести клиента можно только в "Клиентах"). Требует
  // allowZoneSpend+spendZones+zoneSpendEndpointFor, как обычно.
  spendOnlyMode?: boolean;
  // Ошибки поиска/создания/пополнения — красный bounce-тост по центру со
  // звуком (запрос пользователя 2026-07-25: "везде у Сотрудника... где это
  // логично", тот же приём, что "Заказ не найден" в Билетах) вместо обычного
  // текста под полем. Только Сотрудник — Владелец (`/abonements/[id]`)
  // сохраняет прежний инлайн-текст, не передаёт этот проп. Ошибки списания с
  // баланса на месте (spendError, allowZoneSpend) всегда идут тостом — та
  // ветка физически недоступна Владельцу (он не передаёт allowZoneSpend).
  toastErrors?: boolean;
}

export interface SpendTariffCtx {
  id: string;
  name: string;
  price: number;
}

export interface SpendZoneCtx {
  id: string;
  name: string;
  iconKey: string | null;
  accountingMode: "counters" | "cash_only";
  tariffs: SpendTariffCtx[];
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
  allowZoneSpend,
  spendZones,
  zoneSpendEndpointFor,
  printAvailable,
  printBranding,
  spendOnlyMode,
  toastErrors,
}: AbonementTopupFlowProps) {
  const t = useI18n();
  const locale = useLocale();
  const currency = useCurrency();
  const errorToast = useActionToast();
  // Владелец (toastErrors не передан) сохраняет прежний инлайн-текст под
  // полем (см. error state ниже); Сотрудник — bounce-тост со звуком.
  function reportError(message: string) {
    if (toastErrors) {
      playErrorChime();
      errorToast.flash(message, "error");
    } else {
      setError(message);
    }
  }
  // Списание с баланса на месте физически недоступно Владельцу (нет
  // allowZoneSpend/zoneSpendEndpointFor) — тост безусловно, без toastErrors.
  function reportSpendError(message: string) {
    playErrorChime();
    errorToast.flash(message, "error");
  }

  // "Клиент не найден" на шаге поиска телефона — не общий центрированный
  // ActionToast, а локальный zoom-in+bounce прямо над полем/нумпадом (запрос
  // пользователя 2026-07-25: "по идее у тебя такое же как в Билетах при
  // поиске заказа"), тот же приём и разметка, что flashSearchError в
  // operator/tickets/page.tsx. Поле телефона сразу очищается — вводить
  // заново с нуля, как и там.
  const [searchFlash, setSearchFlash] = useState<string | null>(null);
  const searchFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashSearchNotFound(message: string) {
    playErrorChime();
    setSearchFlash(message);
    clearPhoneLocal();
    if (searchFlashTimerRef.current) clearTimeout(searchFlashTimerRef.current);
    searchFlashTimerRef.current = setTimeout(() => setSearchFlash(null), 2500);
  }
  useEffect(
    () => () => {
      if (searchFlashTimerRef.current) clearTimeout(searchFlashTimerRef.current);
    },
    []
  );

  const [phone, setPhone] = useState("");
  // Код страны отдельно (запрос пользователя 2026-07-22) — нужен нумпаду
  // ниже, чтобы дописывать/стирать цифры ПОСЛЕ префикса, не трогая его;
  // PhoneInput сам вычисляет его из часового пояса тенанта и отдаёт наверх
  // через onDialInfo, чтобы не запрашивать timezone второй раз.
  const [dialCode, setDialCode] = useState("+7");
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

  // QR/ссылка на бота для показа клиенту сразу после оплаты (запрос
  // пользователя 2026-07-23: "экран подтверждения оператора — как основной")
  // — грузится один раз при монтировании, а не только когда экран
  // подтверждения показан: пока идёт поиск/оплата, запрос уже успевает
  // отработать в фоне, к моменту показа экрана ссылка уже готова.
  const [telegramBalanceLink, setTelegramBalanceLink] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // Уже привязал бота сам — не тот же самый флаг, что telegramBalanceLink
  // выше (тот про тенанта в целом): предлагать/печатать QR клиенту, который
  // уже это сделал, только шум (запрос пользователя 2026-07-23). Перезапрашивается
  // при каждой смене найденного клиента — новый номер телефона может быть
  // (не) привязан независимо от предыдущего найденного.
  const [foundHasTelegram, setFoundHasTelegram] = useState(false);
  useEffect(() => {
    fetch("/api/tenant/telegram-balance-link")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTelegramBalanceLink(data?.link ?? null))
      .catch(() => {});
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!found?.phone) {
      setFoundHasTelegram(false);
      return;
    }
    fetch(`/api/tenant/telegram-balance-link?phone=${encodeURIComponent(found.phone)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setFoundHasTelegram(!!data?.hasTelegram))
      .catch(() => {});
  }, [found?.phone]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Оплата балансом на месте (не пополнение, списание) — Зона → тарифы
  // (только "Счётчики") → сумма (запрос пользователя 2026-07-20; актив убран
  // из шага 2026-07-24 — сумма зависит только от тарифа, актив не менял
  // цену, только подпись в истории кошелька). Тарифов может быть НЕСКОЛЬКО
  // за раз (запрос того же дня: "чтобы Сотрудник мог списывать сразу
  // несколько тарифов... тап — плюс, рядом кнопка минус, по умолчанию 1") —
  // tariffId → количество, та же механика степпера, что уже есть у Билетов
  // (variantSheet в operator/tickets/page.tsx).
  const [zoneSpendOpen, setZoneSpendOpen] = useState(false);
  const [spendZone, setSpendZone] = useState<SpendZoneCtx | null>(null);
  const [spendQuantities, setSpendQuantities] = useState<Record<string, number>>({});
  const [spendAmount, setSpendAmount] = useState("");
  const [spendSubmitting, setSpendSubmitting] = useState(false);
  const [justDebited, setJustDebited] = useState<{ amount: number; newBalance: number } | null>(null);
  const { saved: spendSaved, pulse: spendPulse } = useSavePulse();

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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      pulseSavedNew();
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance, createdAt: data.createdAt });
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound((prev) => (prev ? { ...prev, name: data.name } : prev));
      setEditingName(false);
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSavingName(false);
    }
  }

  // Нумпад поверх PhoneInput (запрос пользователя 2026-07-22, тот же приём,
  // что у поиска заказа в Билетах) — дописывает/стирает цифры ПОСЛЕ кода
  // страны, физическая клавиатура при этом продолжает работать как обычно
  // (PhoneInput остаётся настоящим <input>), нумпад — просто ещё один способ
  // ввода для тач-устройств, не единственный.
  const dialDigits = dialCode.replace("+", "");
  function tapPhoneDigit(digit: string) {
    setPhone((v) => {
      const local = v.startsWith(dialDigits) ? v.slice(dialDigits.length) : v;
      return dialDigits + local + digit;
    });
  }
  function backspacePhoneDigit() {
    setPhone((v) => {
      const local = v.startsWith(dialDigits) ? v.slice(dialDigits.length) : v;
      return dialDigits + local.slice(0, -1);
    });
  }
  function clearPhoneLocal() {
    setPhone(dialDigits);
  }
  const phoneLocal = phone.startsWith(dialDigits) ? phone.slice(dialDigits.length) : phone;

  function handleSearch() {
    if (!phone.trim() || searching) return;
    setSearching(true);
    if (!toastErrors) setError(null);
    fetch(`${searchEndpoint}?phone=${encodeURIComponent(phone)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          if (toastErrors) flashSearchNotFound(data.error);
          else setError(data.error);
          return;
        }
        // spendOnlyMode не заводит нового клиента (запрос пользователя
        // 2026-07-24: "в этом пункте меню нового добавить нельзя") — "не
        // найден" здесь не отдельный экран с кнопкой "Назад", а тот же
        // bounce-тост, что и "Заказ не найден" в Билетах (запрос
        // пользователя 2026-07-25): found остаётся undefined, оператор
        // остаётся на экране поиска, номер сразу очищается.
        if (spendOnlyMode && !data.abonement) {
          flashSearchNotFound(t.operatorApp.abonement.spendOnlyNotFound);
          return;
        }
        setFound(data.abonement);
      })
      .catch(() => {
        if (toastErrors) flashSearchNotFound(t.operatorApp.gameRoom.networkError);
        else setError(t.operatorApp.gameRoom.networkError);
      })
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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setPendingAction(null);
      setJustCredited({ amount: plan.creditAmount, newBalance: data.balance });
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingAction(null);
      setJustCredited({ amount: plan.creditAmount, newBalance: data.balance });
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setPendingAction(null);
      setJustCredited({ amount, newBalance: data.balance });
      setArbitraryAmount("");
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      setPendingAction(null);
      setJustCredited({ amount, newBalance: data.balance });
      setArbitraryAmount("");
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  function openZoneSpend() {
    setZoneSpendOpen(true);
    // Единственная доступная зона — сразу выбираем, не заставляем тапать по
    // списку из одного пункта (spendZones уже загружен страницей заранее).
    const singleZone = spendZones && spendZones.length === 1 ? spendZones[0] : null;
    setSpendZone(singleZone);
    // По умолчанию 1 (запрос пользователя 2026-07-24) — только когда у
    // единственной зоны и тариф единственный, автовыбор сразу; при
    // нескольких тарифах — пусто, тап добавляет нужные (механика Билетов).
    setSpendQuantities(
      singleZone?.accountingMode === "counters" && singleZone.tariffs.length === 1
        ? { [singleZone.tariffs[0].id]: 1 }
        : {}
    );
    setSpendAmount("");
  }

  // spendOnlyMode: сразу после успешного поиска — на списание, без
  // промежуточной карточки клиента (запрос пользователя 2026-07-24). Не
  // трогает found===null (не нашли) — та ветка ниже не создаёт клиента в
  // этом режиме вовсе, и found===undefined (ещё не искали).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (spendOnlyMode && found && !zoneSpendOpen && !justDebited && !justCredited) {
      openZoneSpend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendOnlyMode, found]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function spendQuantityFor(tariffId: string): number {
    return spendQuantities[tariffId] ?? 0;
  }
  function setSpendTariffQuantity(tariffId: string, quantity: number) {
    setSpendQuantities((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[tariffId];
      else next[tariffId] = quantity;
      return next;
    });
  }
  // Строки корзины тарифов (только "Счётчики") + сумма — та же механика,
  // что у корзины билетов (variantSheet, operator/tickets/page.tsx).
  const spendCartLines =
    spendZone?.accountingMode === "counters"
      ? spendZone.tariffs.map((tf) => ({ tariff: tf, quantity: spendQuantityFor(tf.id) })).filter((l) => l.quantity > 0)
      : [];
  const spendCartTotal = spendCartLines.reduce((sum, l) => sum + l.tariff.price * l.quantity, 0);

  async function submitZoneSpend() {
    if (!found || !zoneSpendEndpointFor || !spendZone || spendSubmitting) return;
    const isCounters = spendZone.accountingMode === "counters";
    // "Счётчики" — сумма считается сервером от реальных цен тарифов×
    // количество (не доверяем клиентскому amount, запрос пользователя
    // 2026-07-24); "Только касса" — своей цены нет, вводится вручную
    // (запрос пользователя 2026-07-20).
    if (isCounters && spendCartLines.length === 0) return;
    const amount = isCounters ? spendCartTotal : parseMoneyInput(spendAmount);
    if (!isCounters && (!Number.isFinite(amount) || amount <= 0)) return;
    setSpendSubmitting(true);
    try {
      const res = await fetch(zoneSpendEndpointFor(found.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: isCounters
          ? JSON.stringify({
              zoneId: spendZone.id,
              lines: spendCartLines.map((l) => ({ tariffId: l.tariff.id, quantity: l.quantity })),
            })
          : JSON.stringify({ zoneId: spendZone.id, amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        reportSpendError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound(data);
      // Зелёная вылетающая галочка на кнопке перед переходом на экран
      // подтверждения (запрос пользователя 2026-07-25) — тот же приём
      // useSavePulse, что и у остальных SaveButton по проекту: держит
      // галочку видимой, только потом закрывает шторку/показывает итог.
      spendPulse(() => {
        setZoneSpendOpen(false);
        setJustDebited({ amount, newBalance: data.balance });
      });
      onSuccess?.();
    } catch {
      reportSpendError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSpendSubmitting(false);
    }
  }

  // Untracked-путь Владельца (см. arbitraryAmountNeedsPaymentMethod выше) —
  // мгновенное зачисление, без способа оплаты, без следа в кассе.
  async function handleAdjust() {
    const amount = parseMoneyInput(arbitraryAmount);
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
        reportError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      setFound({ id: data.id, phone: data.phone, name: data.name, balance: data.balance });
      setJustCredited({ amount, newBalance: data.balance });
      setArbitraryAmount("");
      onSuccess?.();
    } catch {
      reportError(t.operatorApp.gameRoom.networkError);
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
      const amount = parseMoneyInput(arbitraryAmount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      setPendingAction({ kind: "arbitrary", amount });
      return;
    }
    handleAdjust();
  }

  const isNew = found === null;

  // Реальный баг, найден при самопроверке 2026-07-20: после пополнения/
  // списания found обновляется БЕЗ history (POST-ответы её не возвращают,
  // только GET по телефону) — печать выписки сразу после операции
  // показывала бы 0 операций, хотя они только что произошли. Перезапрос по
  // телефону только когда печать вообще доступна (иначе, на странице
  // Владельца, где эта кнопка не рендерится вовсе, лишний запрос не нужен).
  async function refreshHistoryIfPrintable() {
    if (!printAvailable || !found?.phone) return;
    const res = await fetch(`${searchEndpoint}?phone=${encodeURIComponent(found.phone)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.abonement) setFound(data.abonement);
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

  // Итоговая строка операции — запрос пользователя 2026-07-24: "убери
  // везде слово 'Списание', это итак понятно, ведь число с минусом".
  // "Пополнение"/"Возврат"/"Корректировка" оставляем — у одинакового плюса
  // разный смысл, знаком не различить.
  function historyLabel(h: WalletHistoryEntry): string {
    const base = h.planName ?? h.description;
    // Количество (запрос пользователя 2026-07-24) — только у "Счётчиков",
    // где реально можно списать несколько тарифов за раз.
    const detail = base && h.quantity ? `${base} × ${h.quantity}` : base;
    if (h.type === "spend") return detail ?? historyTypeLabel(h);
    return detail ? `${historyTypeLabel(h)} · ${detail}` : historyTypeLabel(h);
  }

  // Выписка баланса (запрос пользователя 2026-07-20) — последние 10 операций,
  // уже приходят с сервера отсортированными (см. /api/operator/abonements).
  // Строка — короткие дата+время (запрос пользователя 2026-07-24: "должна
  // быть дата и время в коротком формате напротив расходов или пополнений")
  // и за что именно списание/пополнение — раньше была только дата и голое
  // "Списание" без пояснения, за что.
  function buildBalanceReceiptData(wallet: WalletCtx): PrintDocumentData {
    return {
      title: t.abonements.receiptTitle,
      // Имя крупнее обычного subtitle, телефон под ним (запрос пользователя
      // 2026-07-20) — без имени телефон и так уже primary, второй раз его
      // не дублируем.
      subtitle: wallet.name ? { primary: wallet.name, secondary: wallet.phone } : wallet.phone,
      sections: [
        {
          title: t.abonements.historyTitle,
          lines: (wallet.history ?? []).map((h) => {
            const when = new Date(h.occurredAt);
            const shortDate = when.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
            const shortTime = when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
            return {
              label: `${shortDate} ${shortTime} · ${historyLabel(h)}`,
              value: `${h.type === "spend" ? "−" : "+"}${formatMoneyWithCurrency(h.amount, locale, currency)}`,
            };
          }),
        },
      ],
      totalLine: { label: t.abonements.balanceLabel, value: formatMoneyWithCurrency(wallet.balance, locale, currency) },
    };
  }

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
          {/* QR на бота — самый горячий момент показать клиенту, как самому
              проверять баланс (запрос пользователя 2026-07-23), телефон и так
              скорее всего уже в руках. */}
          {telegramBalanceLink && !foundHasTelegram && (
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-12 rounded-lg"
                aria-label={t.abonements.telegramBalanceButton}
                onClick={() => setQrOpen(true)}
              >
                <QrCode className="size-5" />
              </Button>
            </PressableScale>
          )}
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
                refreshHistoryIfPrintable();
              }}
            >
              {t.abonements.doneButton}
            </Button>
          </PressableScale>
        </div>
      ) : justDebited ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-8" />
          </div>
          <div>
            <p className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {t.abonements.paymentAcceptedTitle}
            </p>
            <p className="mt-1 text-body-airbnb text-muted-foreground">
              {t.operatorApp.abonement.debitedLabel} −<Money value={justDebited.amount} />
            </p>
          </div>
          <div className="flex w-full items-center justify-between rounded-control bg-muted p-3.5">
            <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.abonement.balanceLabel}</span>
            <span className="text-xl font-extrabold tracking-[-0.02em]">
              <Money value={justDebited.newBalance} />
            </span>
          </div>
          {telegramBalanceLink && !foundHasTelegram && (
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-12 rounded-lg"
                aria-label={t.abonements.telegramBalanceButton}
                onClick={() => setQrOpen(true)}
              >
                <QrCode className="size-5" />
              </Button>
            </PressableScale>
          )}
          <PressableScale className="w-full">
            <Button
              type="button"
              className="h-12 w-full font-bold"
              onClick={() => {
                setJustDebited(null);
                if (spendOnlyMode) {
                  // Следующий клиент — заново с поиска (запрос пользователя
                  // 2026-07-24), а не карточка только что списанного.
                  setFound(undefined);
                  setPhone("");
                } else {
                  refreshHistoryIfPrintable();
                }
              }}
            >
              {t.abonements.doneButton}
            </Button>
          </PressableScale>
        </div>
      ) : zoneSpendOpen ? (
        <>
          {/* spendOnlyMode: единая хлебная крошка снаружи (родительская
              страница "Счётчики") уже даёт "назад" — свой BackLink тут
              дублировал бы её 1-в-1 везде, кроме реального шага "сменить
              зону" при нескольких зонах (запрос пользователя 2026-07-24:
              "должно быть едиными хлебными крошками"). */}
          {(!spendOnlyMode || (spendZones && spendZones.length > 1 && spendZone)) && (
            <BackLink
              label={t.common.back}
              onClick={() => {
                // Пошагово назад: зона → закрыть весь экран списания (та же
                // логика возврата, что у категорий ревизии остатков в /goods,
                // запрос пользователя 2026-07-19). Отдельного шага "тариф" с
                // 2026-07-24 больше нет — количество тарифов правится прямо на
                // экране выбранной зоны (степпер, механика Билетов), не
                // отдельным экраном-подтверждением, поэтому каскад из
                // предыдущей версии (тариф→актив→зона) тут больше не нужен.
                if (spendZones && spendZones.length > 1 && spendZone) setSpendZone(null);
                else if (spendOnlyMode) {
                  setZoneSpendOpen(false);
                  setFound(undefined);
                  setPhone("");
                } else setZoneSpendOpen(false);
              }}
            />
          )}
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.abonement.spendTitle}</h2>

          {!spendZones ? null : spendZones.length === 0 ? (
            <p className="text-caption-airbnb text-destructive">{t.operatorApp.abonement.noSpendZonesError}</p>
          ) : !spendZone ? (
            // Тайлы, как в шаге выбора зон мастера сдачи итогов (запрос
            // пользователя 2026-07-24: "сделай зоны тайлами") — тот же
            // визуальный паттерн (icon+имя, rounded-card), но без чекмарка
            // "выбрано": тут тап сразу ведёт на следующий шаг, а не копит
            // мультивыбор, как в мастере.
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-3">
              {spendZones.map((zone) => (
                <PressableScale key={zone.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSpendZone(zone);
                      // По умолчанию 1 (запрос пользователя 2026-07-24) —
                      // только когда тариф у зоны единственный, автовыбор
                      // сразу вместе с зоной; при нескольких — пусто, тап
                      // добавляет нужные (степпер, механика Билетов).
                      setSpendQuantities(
                        zone.accountingMode === "counters" && zone.tariffs.length === 1
                          ? { [zone.tariffs[0].id]: 1 }
                          : {}
                      );
                    }}
                    className="flex w-full flex-col items-center gap-2.5 rounded-card border-[1.5px] border-border bg-card px-3 py-5 text-center"
                  >
                    <div className="flex size-14 items-center justify-center rounded-control bg-muted text-muted-foreground/50">
                      {zone.iconKey ? (
                        <AssetOrZoneIcon iconKey={zone.iconKey} className="size-9" />
                      ) : (
                        <MapPin className="size-9" />
                      )}
                    </div>
                    <span className="text-[0.90625rem] font-semibold text-foreground">{zone.name}</span>
                  </button>
                </PressableScale>
              ))}
            </div>
          ) : spendZone.accountingMode === "counters" ? (
            // Тайлы, а не строки (запрос пользователя 2026-07-24: "пусть
            // тарифы будут тайлами, так удобнее") — тот же паттерн, что у
            // тайлов зон шагом выше. Тап по тайлу = +1 (счётчик в углу, та
            // же механика, что у корзины Билетов/Товаров), минус — отдельным
            // маленьким кружком в противоположном углу, появляется при qty>0.
            <>
              {/* 2 в ряд, не auto-fill (запрос пользователя 2026-07-24) —
                  тайлам тарифов нужно больше места под минус-кружок в углу,
                  чем у зон/активов, auto-fill сажал по 3-4 и минус вылезал
                  за край тайла на узких экранах. */}
              <div className="grid grid-cols-2 gap-3">
                {spendZone.tariffs.map((tariff) => {
                  const qty = spendQuantityFor(tariff.id);
                  return (
                    <PressableScale key={tariff.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setSpendTariffQuantity(tariff.id, qty + 1)}
                        className={cn(
                          "flex w-full flex-col items-center gap-1.5 rounded-card border-[1.5px] px-3 py-5 text-center",
                          qty > 0 ? "border-primary bg-primary/10" : "border-border bg-card"
                        )}
                      >
                        <span className="text-[0.90625rem] font-semibold text-foreground">{tariff.name}</span>
                        {/* Крупнее (запрос пользователя 2026-07-25) — сумма
                            это главное, что нужно быстро прочитать на
                            тайле, была мельче названия тарифа. */}
                        <span className="text-[1.09375rem] font-extrabold text-primary">
                          <Money value={tariff.price} />
                        </span>
                      </button>
                      {qty > 0 && (
                        <>
                          <span className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-primary text-base font-extrabold text-primary-foreground shadow-md">
                            {qty}
                          </span>
                          {/* Свой угол, не под количеством (запрос
                              пользователя 2026-07-24, уточнение предыдущей
                              правки) — правый нижний угол тайла. Минимум 1
                              (запрос того же дня: "0 не нужен") — минус
                              останавливается на 1, а не убирает тариф
                              целиком; чтобы отменить выбор — крестик/закрыть
                              шаг, не минус. */}
                          <button
                            type="button"
                            aria-label={t.common.delete}
                            disabled={qty <= 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSpendTariffQuantity(tariff.id, Math.max(1, qty - 1));
                            }}
                            className="absolute -right-2 -bottom-2 flex size-9 items-center justify-center rounded-full border border-border bg-card shadow-md disabled:opacity-40"
                          >
                            <Minus className="size-5" />
                          </button>
                          {/* Плюс в противоположном от минуса углу (запрос
                              пользователя 2026-07-24) — то же действие, что
                              тап по самому тайлу, просто явная симметричная
                              кнопка рядом с минусом, не только неявный тап. */}
                          <button
                            type="button"
                            aria-label={t.common.add}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSpendTariffQuantity(tariff.id, qty + 1);
                            }}
                            className="absolute -left-2 -bottom-2 flex size-9 items-center justify-center rounded-full border border-border bg-card shadow-md"
                          >
                            <Plus className="size-5" />
                          </button>
                        </>
                      )}
                    </PressableScale>
                  );
                })}
              </div>
              {spendCartLines.length > 0 && (
                <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
                  <span className="text-caption-airbnb text-muted-foreground">{t.money.amountLabel}</span>
                  <span className="text-xl font-extrabold tabular-nums tracking-[-0.02em]">
                    <Money value={spendCartTotal} />
                  </span>
                </div>
              )}
              <PressableScale>
                <SaveButton
                  type="button"
                  className="h-12 w-full font-bold"
                  disabled={spendSubmitting || spendCartLines.length === 0}
                  saved={spendSaved}
                  onClick={submitZoneSpend}
                >
                  {t.operatorApp.abonement.spendButton}
                </SaveButton>
              </PressableScale>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="spendAmount">{t.money.amountLabel}</Label>
                <MoneyInput
                  id="spendAmount"
                  scale="lg"
                  value={spendAmount}
                  onChange={(e) => setSpendAmount(e.target.value)}
                />
              </div>
              <PressableScale>
                <SaveButton
                  type="button"
                  className="h-12 w-full font-bold"
                  disabled={spendSubmitting || parseMoneyInput(spendAmount) <= 0}
                  saved={spendSaved}
                  onClick={submitZoneSpend}
                >
                  {t.operatorApp.abonement.spendButton}
                </SaveButton>
              </PressableScale>
            </>
          )}
        </>
      ) : pendingAction ? (
        <>
          <BackLink label={t.common.back} onClick={() => setPendingAction(null)} />
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {t.operatorApp.gameRoom.paymentMethodTitle}
          </h2>
          {/* Крупно и по центру (запрос пользователя 2026-07-25) — раньше была
              мелкая серая подпись, сумма на этом шаге теряется рядом с
              заголовком. У абонемента — двумя строками: название сверху,
              Цена → Зачисляется снизу, тем же крупным начертанием. */}
          {pendingAction.kind === "plan" ? (
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-lg font-bold">{pendingAction.plan.name ?? <Money value={pendingAction.plan.price} />}</p>
              <div className="flex items-center gap-2.5">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[2.125rem] font-extrabold leading-none tabular-nums tracking-[-0.02em] text-primary">
                    <Money value={pendingAction.plan.price} />
                  </span>
                  <span className="text-caption-airbnb text-muted-foreground">{t.abonements.priceLabel}</span>
                </div>
                <ArrowBigRight className="size-6 shrink-0 fill-muted-foreground text-muted-foreground" />
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[2.125rem] font-extrabold leading-none tabular-nums tracking-[-0.02em] text-primary">
                    <Money value={pendingAction.plan.creditAmount} />
                  </span>
                  <span className="text-caption-airbnb text-muted-foreground">{t.abonements.creditAmountLabel}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-[2.125rem] font-extrabold leading-none tabular-nums tracking-[-0.02em] text-primary">
              <Money value={pendingAction.amount} />
            </p>
          )}
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
        <div className="relative flex flex-col gap-3">
          {/* "Клиент не найден" — zoom-in+bounce прямо над полем/нумпадом,
              не текстовая строка (запрос пользователя 2026-07-25: "такое же
              как в Билетах при поиске заказа"), тот же приём и разметка, что
              flashSearchError в operator/tickets/page.tsx. */}
          <AnimatePresence>
            {searchFlash && (
              <motion.div
                key="search-not-found-toast"
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
                  <span className="text-lg font-extrabold">{searchFlash}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
              onDialInfo={({ dialCode }) => setDialCode(dialCode)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              heightClassName="h-14"
              sizeClassName="text-2xl font-extrabold tabular-nums"
            />
          </div>
          {/* Нумпад — дополнительный способ ввода для тач-устройств (запрос
              пользователя 2026-07-22), не единственный: поле выше остаётся
              настоящим input, с клавиатуры печатать можно и без нумпада. */}
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
              <PressableScale key={k}>
                <button
                  type="button"
                  onClick={() => tapPhoneDigit(k)}
                  className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-xl font-bold tabular-nums shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] dark:border-input dark:bg-input/30"
                >
                  {k}
                </button>
              </PressableScale>
            ))}
            <PressableScale>
              <button
                type="button"
                disabled={!phoneLocal}
                onClick={clearPhoneLocal}
                aria-label={t.common.delete}
                className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-muted-foreground shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] disabled:opacity-40 dark:border-input dark:bg-input/30"
              >
                <Trash2 className="size-5" />
              </button>
            </PressableScale>
            <PressableScale>
              <button
                type="button"
                onClick={() => tapPhoneDigit("0")}
                className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background text-xl font-bold tabular-nums shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] dark:border-input dark:bg-input/30"
              >
                0
              </button>
            </PressableScale>
            <PressableScale>
              <button
                type="button"
                disabled={!phoneLocal}
                onClick={backspacePhoneDigit}
                aria-label={t.common.back}
                className="flex h-14 w-full items-center justify-center rounded-control border border-border bg-background shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] disabled:opacity-40 dark:border-input dark:bg-input/30"
              >
                <Delete className="size-5" />
              </button>
            </PressableScale>
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
              {searching
                ? t.operatorApp.abonement.searching
                : spendOnlyMode
                  ? t.operatorApp.abonement.searchOnlyButton
                  : t.operatorApp.abonement.searchButton}
            </Button>
          </PressableScale>
        </div>
      ) : (
        <>
          {!initialWallet && (
            <>
              <BackLink label={t.common.back} onClick={() => setFound(undefined)} />
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
                          <PressableScale className="shrink-0">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="rounded-lg"
                              onClick={() => {
                                setNameDraft(found?.name ?? "");
                                setEditingName(true);
                              }}
                              aria-label={t.common.edit}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          </PressableScale>
                        )}
                        {/* Значок статуса Telegram — виден всегда, когда бот
                            вообще настроен (запрос пользователя 2026-07-23):
                            пока клиент ещё не привязан — настоящая кнопка,
                            той же формы, что у "Нового клиента"; привязал сам
                            — просто чёрный неактивный значок, без рамки и
                            без действия. */}
                        {!isNew && found && telegramBalanceLink && (
                          foundHasTelegram ? (
                            <span className="ml-auto shrink-0 text-primary" aria-label={t.abonements.telegramLinkedLabel}>
                              <Send className="size-5" />
                            </span>
                          ) : (
                            <PressableScale className="ml-auto shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="rounded-lg"
                                onClick={() => setQrOpen(true)}
                                aria-label={t.abonements.telegramBalanceButton}
                              >
                                <QrCode className="size-4" />
                              </Button>
                            </PressableScale>
                          )
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
                    {/* Новый клиент по определению ещё не мог привязать бота
                        раньше (см. hasTelegramLink) — тут в одном ряду с
                        заголовком, не проверяем foundHasTelegram. */}
                    {isNew && telegramBalanceLink && (
                      <PressableScale className="shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-lg"
                          aria-label={t.abonements.telegramBalanceButton}
                          onClick={() => setQrOpen(true)}
                        >
                          <QrCode className="size-5" />
                        </Button>
                      </PressableScale>
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
                  {/* Выписка баланса — печать по требованию (модуль печати,
                      запрос пользователя 2026-07-20), только когда снаружи
                      явно передали printAvailable/printBranding (Оператор) —
                      у Владельца эта кнопка уже есть на самой странице
                      /abonements/[id], дублировать её тут не нужно. */}
                  {!isNew && found && printAvailable && printBranding && (
                    <div className="mt-3 border-t border-border pt-3">
                      <PrintButton
                        label={t.abonements.printReceiptButton}
                        data={buildBalanceReceiptData(found)}
                        branding={printBranding}
                        className="w-full gap-1.5 rounded-lg"
                      />
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

          {/* Оплата балансом на месте — только Сотрудник, только для уже
              найденного/созданного клиента (запрос пользователя 2026-07-20). */}
          {allowZoneSpend && spendZones && spendZones.length > 0 && !isNew && found && (
            <PressableScale>
              <Button type="button" className="h-12 w-full gap-1.5 font-bold" onClick={openZoneSpend}>
                <Wallet className="size-4.5" />
                {t.operatorApp.abonement.spendTitle}
              </Button>
            </PressableScale>
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
                    className="h-12 shrink-0 font-bold"
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

      {!toastErrors && error && <p className="text-sm text-destructive">{error}</p>}
      {toastErrors && <ActionToast message={errorToast.message} variant={errorToast.variant} />}

      {telegramBalanceLink && (
        <InstructionQrSheet
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          title={t.abonements.telegramConnectSheetTitle}
          url={telegramBalanceLink}
        />
      )}
    </div>
  );
}
