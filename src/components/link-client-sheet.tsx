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
