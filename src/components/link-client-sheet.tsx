"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/back-link";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Money } from "@/components/money";
import { PhoneInput } from "@/components/phone-input";
import { useI18n } from "@/components/i18n-provider";

export interface LinkedClientInfo {
  id: string;
  phone: string;
  name: string | null;
  balance: number;
}

interface LinkClientSheetProps {
  open: boolean;
  onClose: () => void;
  // Базовый URL конкретного link-client роута сущности (например,
  // `/api/launches/${id}/link-client` у Прибываний или
  // `/api/operator/goods/held-orders/${id}/link-client` у Товаров, запрос
  // пользователя 2026-07-31: "абсолютно по тому же принципу") — сам sheet
  // ничего не знает про Launch/GoodsHeldOrder конкретно, просто GET
  // (?phone=)/POST/DELETE по этому адресу, тот же контракт у обеих сторон.
  endpoint: string | null;
  // Уже привязан — сразу открываем на просмотре, не на поиске.
  current: LinkedClientInfo | null;
  onLinked: (client: LinkedClientInfo) => void;
  onUnlinked: () => void;
}

/**
 * Привязка "чей это ребёнок" к идущему браслету "Прибываний" (запрос
 * пользователя 2026-07-27), позже переиспользована для отложенных заказов
 * Товаров (запрос пользователя 2026-07-31, тот же принцип) — "Найти или
 * Новый", тот же принцип, что и везде в проекте для клиентов
 * (AbonementPaymentSheet/abonement-topup-flow): сначала явный поиск по
 * телефону, оператор ВИДИТ результат, и только тогда либо привязывает
 * найденного, либо (если не нашли) заводит нового — не молчаливое
 * find-or-create одним действием. На шаге "Новый клиент" — тот же
 * стандартный интерфейс, что и везде в проекте (запрос пользователя
 * 2026-07-27), поле "Имя" необязательно (t.operatorApp.abonement.nameLabel,
 * тот же ключ, что в abonement-topup-flow.tsx). Никак не влияет на способ
 * оплаты.
 */
export function LinkClientSheet({ open, onClose, endpoint, current, onLinked, onUnlinked }: LinkClientSheetProps) {
  const t = useI18n();
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  // undefined — ещё не искали; null — искали, не нашли; объект — нашли.
  const [found, setFound] = useState<LinkedClientInfo | null | undefined>(undefined);
  // Похожие по хвосту номера — показываются вместо голого «Новый клиент»,
  // когда точного совпадения нет (реальный баг с прода 2026-08-13: сотрудник
  // искал 077942424 и 77942424, клиент сохранён как 37377942424, привязка
  // молча предлагала завести дубликат).
  const [similar, setSimilar] = useState<LinkedClientInfo[]>([]);

  // Выбор кандидата: подставляем его точный номер и повторяем поиск — дальше
  // экран не отличается от случая, когда номер набрали верно сразу.
  function selectSimilar(exactPhone: string) {
    setPhone(exactPhone);
    setSimilar([]);
    setSearching(true);
    fetch(`${endpoint}?phone=${encodeURIComponent(exactPhone)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setFound(data.client ?? null);
      })
      .catch(() => {})
      .finally(() => setSearching(false));
  }
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setPhone("");
      setFound(undefined);
      setName("");
      setError(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleSearch() {
    if (!phone.trim() || searching || !endpoint) return;
    setSearching(true);
    setError(null);
    fetch(`${endpoint}?phone=${encodeURIComponent(phone)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setSimilar(data.similar ?? []);
        setFound(data.client ?? null);
      })
      .catch(() => setError(t.operatorApp.gameRoom.networkError))
      .finally(() => setSearching(false));
  }

  async function submitLink(body: { walletId: string } | { phone: string; name?: string }) {
    if (!endpoint || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.operatorApp.gameRoom.networkError);
        return;
      }
      onLinked(data);
    } catch {
      setError(t.operatorApp.gameRoom.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlink() {
    if (!endpoint || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) onUnlinked();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-3 pt-2">
        {current ? (
          <>
            <h2 className="flex flex-wrap items-baseline gap-x-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              <span>{current.name || current.phone}</span>
              {current.name && (
                <span className="text-base font-semibold text-muted-foreground tabular-nums">{current.phone}</span>
              )}
            </h2>
            <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
              <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.abonement.balanceLabel}</span>
              <span className="text-xl font-extrabold tracking-[-0.02em]">
                <Money value={current.balance} />
              </span>
            </div>
            <PressableScale>
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full font-semibold text-destructive"
                disabled={submitting}
                onClick={handleUnlink}
              >
                {t.operatorApp.gameRoom.unlinkClientButton}
              </Button>
            </PressableScale>
          </>
        ) : found === undefined ? (
          <>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.abonement.searchTitle}</h2>
            <div className="flex flex-col gap-1">
              <Label htmlFor="linkClientPhone">{t.operatorApp.abonement.phoneLabel}</Label>
              <PhoneInput
                id="linkClientPhone"
                autoFocus
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
                {/* "Найти или Новый" (запрос пользователя 2026-07-27: "принцип
                    у нас уже существует") — тот же ключ/формулировка, что в
                    abonement-topup-flow.tsx, не отдельная новая кнопка на
                    "не найден". */}
                {searching ? t.operatorApp.abonement.searching : t.operatorApp.abonement.searchButton}
              </Button>
            </PressableScale>
          </>
        ) : found === null ? (
          <>
            <BackLink label={t.common.back} onClick={() => setFound(undefined)} />
            {/* t.operatorApp.abonement.newTitle — тот же заголовок "Новый
                клиент", что и в abonement-topup-flow.tsx. Поле "Имя" — тот же
                стандартный интерфейс добавления клиента, что и везде в
                проекте (запрос пользователя 2026-07-27), тот же ключ
                nameLabel, не своя формулировка. */}
            {/* Кандидаты — ВЫШЕ формы нового клиента: сотрудник должен
                увидеть «такой клиент уже есть» раньше, чем кнопку завести
                ещё одного. Автоподстановки нет — совпадение хвоста значит
                «похоже», а не «это он», выбирает человек. */}
            {similar.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-section-title">{t.operatorApp.abonement.similarTitle}</span>
                {similar.map((s) => (
                  <PressableScale key={s.id}>
                    <button
                      type="button"
                      onClick={() => selectSimilar(s.phone)}
                      className="flex w-full items-center justify-between gap-3 rounded-control border border-border bg-card px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-body-airbnb font-semibold">
                          {s.name || t.operatorApp.abonement.noName}
                        </span>
                        <span className="block truncate tabular-nums text-caption-airbnb">{s.phone}</span>
                      </span>
                      <span className="shrink-0 text-body-airbnb font-bold tabular-nums">
                        <Money value={s.balance} />
                      </span>
                    </button>
                  </PressableScale>
                ))}
              </div>
            )}
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.operatorApp.abonement.newTitle}</h2>
            <p className="text-caption-airbnb text-muted-foreground">{phone}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="linkClientName">{t.operatorApp.abonement.nameLabel}</Label>
              <Input
                id="linkClientName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 rounded-control bg-muted"
              />
            </div>
            <PressableScale>
              <Button
                type="button"
                className="h-12 w-full font-semibold"
                disabled={submitting}
                onClick={() => submitLink({ phone, name: name.trim() || undefined })}
              >
                {t.operatorApp.gameRoom.linkClientAssignButton}
              </Button>
            </PressableScale>
          </>
        ) : (
          <>
            <BackLink label={t.common.back} onClick={() => setFound(undefined)} />
            <h2 className="flex flex-wrap items-baseline gap-x-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              <span>{found.name || found.phone}</span>
              {found.name && (
                <span className="text-base font-semibold text-muted-foreground tabular-nums">{found.phone}</span>
              )}
            </h2>
            <div className="flex items-center justify-between rounded-control bg-muted p-3.5">
              <span className="text-caption-airbnb text-muted-foreground">{t.operatorApp.abonement.balanceLabel}</span>
              <span className="text-xl font-extrabold tracking-[-0.02em]">
                <Money value={found.balance} />
              </span>
            </div>
            <PressableScale>
              <Button
                type="button"
                className="h-12 w-full font-semibold"
                disabled={submitting}
                onClick={() => submitLink({ walletId: found.id })}
              >
                {t.operatorApp.gameRoom.linkClientAssignButton}
              </Button>
            </PressableScale>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </BottomSheet>
  );
}
