"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CreditCard, Wallet, Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { KebabButton, ActionSheetItem } from "@/components/kebab-menu";
import { Money } from "@/components/money";
import { AbonementTopupSheet } from "@/components/abonement-topup-sheet";
import { useI18n } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface AbonementInfo {
  id: string;
  name: string | null;
  price: number;
  creditAmount: number;
  pointIds: string[];
}

interface PointOption {
  id: string;
  name: string;
}

interface WalletInfo {
  id: string;
  phone: string;
  name: string | null;
  balance: number;
}

const EMPTY_FORM = { name: "", price: "", creditAmount: "" };

/**
 * Модуль "Абонементы" (запрос пользователя 2026-07-17) — кабинет владельца:
 * тариф-планы ("заплатить price → зачислить creditAmount"), полный CRUD
 * ("создавать новые/редактировать/удалять"). Изначально были две отдельные
 * сущности — "Пакет пополнения" (без телефона) и "Абонемент" (кошелёк
 * клиента, телефон+баланс) — объединены в одну по прямой обратной связи
 * пользователя того же дня ("Я добавляю абонимент а не пакет", "неправильно,
 * что я добавил абонемент и просто указал баланс — нет логики"): владелец
 * управляет ТОЛЬКО планами, кошелёк клиента появляется автоматически при
 * продаже плана оператором (см. /api/operator/abonements), без ручного ввода
 * произвольного баланса. Точки продажи — опционально ограничены (пусто =
 * все точки тенанта, запрос того же дня: "выбор действует ли он на все точки
 * клиента или нет").
 */
export default function AbonementsPage() {
  const t = useI18n();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const [abonements, setAbonements] = useState<AbonementInfo[]>([]);
  const [points, setPoints] = useState<PointOption[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pointsAll, setPointsAll] = useState(true);
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { saved, pulse } = useSavePulse();
  const [kebabTarget, setKebabTarget] = useState<AbonementInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { saved: deleted, pulse: deletePulse } = useSavePulse();

  const [topupSheetOpen, setTopupSheetOpen] = useState(false);
  const [topupPointId, setTopupPointId] = useState<string | null>(null);

  // Список кошельков клиентов (запрос пользователя 2026-07-17: "у владельца
  // так и не виден список активных абонентов") + полный CRUD ("нет ни
  // истории купленных абонементов, ни возможности... удалить, ни
  // редактировать") — сама продажа/первое создание — через sheet "Продать",
  // тут только правка имени/телефона существующего и просмотр истории.
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletQuery, setWalletQuery] = useState("");
  const [walletKebabTarget, setWalletKebabTarget] = useState<WalletInfo | null>(null);
  const [walletConfirmDelete, setWalletConfirmDelete] = useState(false);
  const { saved: walletDeleted, pulse: walletDeletePulse } = useSavePulse();

  async function loadAbonements() {
    const res = await fetch("/api/abonements");
    const data = await res.json();
    setAbonements(data.abonements ?? []);
  }

  async function loadWallets(q?: string) {
    const res = await fetch(`/api/abonement-wallets/list${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const data = await res.json();
    setWallets(data.wallets ?? []);
  }

  async function deleteWallet() {
    if (!walletKebabTarget) return;
    await fetch(`/api/abonement-wallets/${walletKebabTarget.id}`, { method: "DELETE" });
    await loadWallets(walletQuery);
    walletDeletePulse(() => {
      setWalletConfirmDelete(false);
      setWalletKebabTarget(null);
    });
  }

  async function loadPoints() {
    const res = await fetch("/api/points");
    const data = await res.json();
    const list = (data.points ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }));
    setPoints(list);
    // Точка по умолчанию — первая из списка (не только когда она одна):
    // без дефолта пикер оставался пустым и кнопка "Найти" молча не
    // включалась без единой подсказки почему (баг, найденный пользователем
    // 2026-07-17 — "нет возможности добавить абонента"), владелец может
    // переключить на другую точку явно, если нужно другую.
    if (list.length > 0) setTopupPointId(list[0].id);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    Promise.all([loadAbonements(), loadPoints(), loadWallets()]).then(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPointsAll(true);
    setSelectedPointIds(new Set());
    setError(null);
    setSheetOpen(true);
  }

  function openEdit(a: AbonementInfo) {
    setEditingId(a.id);
    setForm({ name: a.name ?? "", price: String(a.price), creditAmount: String(a.creditAmount) });
    setPointsAll(a.pointIds.length === 0);
    setSelectedPointIds(new Set(a.pointIds));
    setError(null);
    setKebabTarget(null);
    setSheetOpen(true);
  }

  function togglePoint(pointId: string) {
    setSelectedPointIds((prev) => {
      const next = new Set(prev);
      if (next.has(pointId)) next.delete(pointId);
      else next.add(pointId);
      return next;
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const price = Number(form.price);
    const creditAmount = Number(form.creditAmount);
    // Зачисленный баланс не может быть меньше цены (запрос пользователя
    // 2026-07-17) — иначе это не бонус клиенту, а скрытая недостача.
    // Проверка тут — быстрая обратная связь без round-trip; API проверяет
    // то же самое как источник истины.
    if (creditAmount < price) {
      setError(t.abonements.creditBelowPriceError);
      return;
    }
    const body = {
      name: form.name.trim() || undefined,
      price,
      creditAmount,
      pointIds: pointsAll ? [] : [...selectedPointIds],
    };
    const res = await fetch(editingId ? `/api/abonements/${editingId}` : "/api/abonements", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Не удалось сохранить");
      return;
    }
    await loadAbonements();
    pulse(() => setSheetOpen(false));
  }

  async function remove() {
    if (!kebabTarget) return;
    await fetch(`/api/abonements/${kebabTarget.id}`, { method: "DELETE" });
    await loadAbonements();
    deletePulse(() => {
      setConfirmDelete(false);
      setKebabTarget(null);
    });
  }

  // План виден в точке, если он "на всех точках" (пустой pointIds) или явно
  // включает выбранную — то же правило, что серверный visibleAtPoint в
  // src/lib/abonement.ts, только на клиенте (пикер точки уже загружен здесь).
  const plansAtTopupPoint = useMemo(
    () => abonements.filter((a) => a.pointIds.length === 0 || (topupPointId ? a.pointIds.includes(topupPointId) : false)),
    [abonements, topupPointId]
  );

  function pointsLabel(pointIds: string[]) {
    if (pointIds.length === 0) return t.abonements.allPointsLabel;
    const names = pointIds.map((id) => points.find((p) => p.id === id)?.name).filter(Boolean);
    return names.join(", ") || t.abonements.allPointsLabel;
  }

  if (checking) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-screen-title">{t.abonements.title}</h1>
              <p className="text-caption-airbnb">{t.abonements.pageSub}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <PressableScale>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTopupSheetOpen(true)}>
                  <Wallet className="size-4" />
                  {t.abonements.sellButton}
                </Button>
              </PressableScale>
              <PressableScale>
                <Button variant="dark" size="sm" className="gap-1.5" onClick={openNew}>
                  <Plus className="size-4" />
                  {t.abonements.addButton}
                </Button>
              </PressableScale>
            </div>
          </div>

          {abonements.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.abonements.noAbonements}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3">
              {abonements.map((a) => (
                <StaggerItem key={a.id}>
                  <SpringCard animate={false}>
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                        <CreditCard className="size-5" />
                      </div>
                      <div className="min-w-0 grow">
                        <div className="text-card-title">
                          {a.name ?? <Money value={a.price} />}
                        </div>
                        <p className="text-caption-airbnb tabular-nums">
                          <Money value={a.price} /> → <Money value={a.creditAmount} /> · {pointsLabel(a.pointIds)}
                        </p>
                      </div>
                      <KebabButton onClick={() => setKebabTarget(a)} label={t.abonements.editAction} />
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}

          <div className="mt-8 mb-3 flex items-center justify-between gap-3">
            <h2 className="text-section-title">{t.abonements.walletsTitle}</h2>
            <PressableScale>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTopupSheetOpen(true)}>
                <Plus className="size-4" />
                {t.abonements.sellButton}
              </Button>
            </PressableScale>
          </div>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t.abonements.walletsSearchPlaceholder}
              value={walletQuery}
              onChange={(e) => {
                setWalletQuery(e.target.value);
                loadWallets(e.target.value);
              }}
              className="pl-9"
            />
          </div>

          {wallets.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.abonements.noWallets}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3">
              {wallets.map((w) => (
                <StaggerItem key={w.id}>
                  {/* Вся карточка кликабельна — сразу в историю/редактирование
                      (запрос пользователя 2026-07-17: "надо иметь возможность
                      войти, чтобы увидеть историю", раньше только кебаб вёл
                      туда через лишний промежуточный шаг). Кебаб внутри
                      останавливает всплытие — иначе клик по нему открывал бы
                      И своё меню, И детальный sheet разом. */}
                  <SpringCard animate={false} className="cursor-pointer" onClick={() => router.push(`/abonements/${w.id}`)}>
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                        <Wallet className="size-5" />
                      </div>
                      <div className="min-w-0 grow">
                        <div className="text-card-title">{w.name || w.phone}</div>
                        <p className="text-caption-airbnb tabular-nums">
                          {w.name ? `${w.phone} · ` : ""}
                          {t.abonements.balanceLabel}: <Money value={w.balance} />
                        </p>
                      </div>
                      <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                      <div onClick={(e) => e.stopPropagation()}>
                        <KebabButton onClick={() => setWalletKebabTarget(w)} label={t.abonements.editAction} />
                      </div>
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <form onSubmit={save} className="flex flex-col gap-4 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">
            {editingId ? t.abonements.editAbonementTitle : t.abonements.newAbonementTitle}
          </h2>
          <div className="flex flex-col gap-1">
            <Label htmlFor="aName">{t.abonements.nameLabel}</Label>
            <Input
              id="aName"
              autoFocus
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="aPrice">{t.abonements.priceLabel}</Label>
              <MoneyInput
                id="aPrice"
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="aCredit">{t.abonements.creditAmountLabel}</Label>
              <MoneyInput
                id="aCredit"
                inputMode="numeric"
                value={form.creditAmount}
                onChange={(e) => setForm((p) => ({ ...p, creditAmount: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-caption-airbnb font-semibold text-foreground">{t.abonements.pointsLabel}</p>
            <div className="flex w-full items-center justify-between border-t border-border py-3.5 text-body-airbnb first:border-t-0">
              {t.abonements.allPointsLabel}
              <Switch checked={pointsAll} onCheckedChange={setPointsAll} />
            </div>
            {!pointsAll && (
              <div className="-mt-1 max-h-56 overflow-y-auto">
                {points.map((point) => (
                  <div
                    key={point.id}
                    className="flex w-full items-center justify-between border-t border-border py-3.5 text-body-airbnb first:border-t-0"
                  >
                    {point.name}
                    <Switch checked={selectedPointIds.has(point.id)} onCheckedChange={() => togglePoint(point.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <SaveButton type="submit" className="h-12 w-full" saved={saved} />
          </PressableScale>
        </form>
      </BottomSheet>

      <BottomSheet open={kebabTarget !== null && !confirmDelete} onClose={() => setKebabTarget(null)}>
        {kebabTarget && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {kebabTarget.name ?? <Money value={kebabTarget.price} />}
            </h2>
            <ActionSheetItem icon={Pencil} onClick={() => openEdit(kebabTarget)}>
              {t.abonements.editAction}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setConfirmDelete(true)}>
              {t.abonements.deleteAbonement}
            </ActionSheetItem>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.abonements.deleteAbonement}</h2>
          <p className="text-body-airbnb">{t.abonements.confirmDeleteAbonement}</p>
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={remove} deleted={deleted} />
          </PressableScale>
        </div>
      </BottomSheet>

      <AbonementTopupSheet
        open={topupSheetOpen}
        onClose={() => setTopupSheetOpen(false)}
        plans={plansAtTopupPoint}
        searchEndpoint="/api/abonement-wallets"
        createEndpoint="/api/abonement-wallets"
        topupEndpointFor={(walletId) => `/api/abonement-wallets/${walletId}/topup`}
        updateNameEndpointFor={(walletId) => `/api/abonement-wallets/${walletId}`}
        extraBody={topupPointId ? { pointId: topupPointId } : undefined}
        pointPicker={{ options: points, value: topupPointId, onChange: setTopupPointId }}
        allowArbitraryAmount
        onSuccess={() => loadWallets(walletQuery)}
      />

      <BottomSheet open={walletKebabTarget !== null && !walletConfirmDelete} onClose={() => setWalletKebabTarget(null)}>
        {walletKebabTarget && (
          <div className="pt-2">
            <h2 className="mb-2 text-[1.1875rem] font-extrabold tracking-[-0.01em]">
              {walletKebabTarget.name || walletKebabTarget.phone}
            </h2>
            <ActionSheetItem icon={Pencil} onClick={() => router.push(`/abonements/${walletKebabTarget.id}`)}>
              {t.abonements.editAction}
            </ActionSheetItem>
            <ActionSheetItem icon={Trash2} destructive onClick={() => setWalletConfirmDelete(true)}>
              {t.abonements.deleteWallet}
            </ActionSheetItem>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={walletConfirmDelete} onClose={() => setWalletConfirmDelete(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.abonements.deleteWallet}</h2>
          <p className="text-body-airbnb">{t.abonements.confirmDeleteWallet}</p>
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={deleteWallet} deleted={walletDeleted} />
          </PressableScale>
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
