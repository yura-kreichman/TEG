"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Gift, Search, ChevronRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Skeleton, SkeletonListRows } from "@/components/ui/skeleton";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { PressableScale } from "@/components/motion/pressable-scale";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { IconActionButton } from "@/components/kebab-menu";
import { Money } from "@/components/money";
import { AbonementTopupSheet } from "@/components/abonement-topup-sheet";
import { useI18n } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";

interface AbonementInfo {
  id: string;
  name: string | null;
  price: number;
  creditAmount: number;
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
  // Два таба, как в "Отчётах" (запрос пользователя 2026-07-18: "слишком
  // большой экран получается") — раньше планы и кошельки клиентов были на
  // одной длинной странице. "wallets" по умолчанию — это то, чем владелец
  // пользуется чаще день в день (поиск/правка абонента), планы правятся
  // редко.
  const [tab, setTab] = useState<"wallets" | "abonements">("wallets");

  const [abonements, setAbonements] = useState<AbonementInfo[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const { saved, pulse } = useSavePulse();
  const [kebabTarget, setKebabTarget] = useState<AbonementInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { saved: deleted, pulse: deletePulse } = useSavePulse();

  const [topupSheetOpen, setTopupSheetOpen] = useState(false);

  // Список кошельков клиентов (запрос пользователя 2026-07-17: "у владельца
  // так и не виден список активных абонентов") + полный CRUD ("нет ни
  // истории купленных абонементов, ни возможности... удалить, ни
  // редактировать") — сама продажа/первое создание — через sheet "Продать",
  // тут только правка имени/телефона существующего и просмотр истории.
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletQuery, setWalletQuery] = useState("");
  // Сортировка списка абонентов (запрос пользователя 2026-07-18: "по
  // балансу, активности и стажу") — "recent" (по умолчанию, недавно
  // созданные сверху) не показывается отдельным пунктом в переключателе,
  // это его исходное состояние.
  const [walletSort, setWalletSort] = useState<"recent" | "balance" | "activity" | "tenure">("recent");
  const [walletKebabTarget, setWalletKebabTarget] = useState<WalletInfo | null>(null);
  const [walletConfirmDelete, setWalletConfirmDelete] = useState(false);
  const { saved: walletDeleted, pulse: walletDeletePulse } = useSavePulse();

  async function loadAbonements() {
    const res = await fetch("/api/abonements");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (res.status === 403) {
      router.replace("/");
      return;
    }
    const data = await res.json();
    setAbonements(data.abonements ?? []);
  }

  async function loadWallets(q?: string, sort?: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort && sort !== "recent") params.set("sort", sort);
    const qs = params.toString();
    const res = await fetch(`/api/abonement-wallets/list${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    setWallets(data.wallets ?? []);
  }

  async function deleteWallet() {
    if (!walletKebabTarget) return;
    await fetch(`/api/abonement-wallets/${walletKebabTarget.id}`, { method: "DELETE" });
    await loadWallets(walletQuery, walletSort);
    walletDeletePulse(() => {
      setWalletConfirmDelete(false);
      setWalletKebabTarget(null);
    });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    Promise.all([loadAbonements(), loadWallets()]).then(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setSheetOpen(true);
  }

  function openEdit(a: AbonementInfo) {
    setEditingId(a.id);
    setForm({ name: a.name ?? "", price: String(a.price), creditAmount: String(a.creditAmount) });
    setError(null);
    setKebabTarget(null);
    setSheetOpen(true);
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

  function openDeleteAbonementConfirm(a: AbonementInfo) {
    setKebabTarget(a);
    setConfirmDelete(true);
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

  if (checking) {
    return (
      <OwnerShell>
        <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
          <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
            <Skeleton className="mb-4 h-7 w-32" />
            <Skeleton className="mb-4 h-8" />
            <div className="flex flex-col gap-3.5">
              <SkeletonListRows count={4} />
            </div>
          </div>
        </div>
      </OwnerShell>
    );
  }

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          {/* "Абоненты", не "Абонементы" (запрос пользователя 2026-07-18) —
              заголовок страницы должен совпадать с пунктом меню, ведущим
              сюда (t.abonements.walletsTitle), а не с одним из двух табов
              внутри. */}
          <h1 className="mb-4 text-screen-title">{t.abonements.walletsTitle}</h1>

          {/* Два таба вместо одной длинной страницы (запрос пользователя
              2026-07-18: "слишком большой экран получается", тот же приём,
              что в "Отчётах") — планы и кошельки клиентов правятся отдельно,
              смешивать в один список незачем. */}
          <SegmentedTabs
            className="mb-4 grid grid-cols-2"
            equalWidth
            size="sm"
            options={[
              { key: "wallets", label: t.abonements.walletsTitle },
              { key: "abonements", label: t.abonements.title },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "abonements" && (
            <>
              <div className="mb-3 flex justify-end">
                <PressableScale>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={openNew}>
                    <Plus className="size-4" />
                    {t.abonements.addButton}
                  </Button>
                </PressableScale>
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
                            <Gift className="size-5" />
                          </div>
                          <div className="min-w-0 grow">
                            <div className="text-card-title">
                              {a.name ?? <Money value={a.price} />}
                            </div>
                            <p className="text-caption-airbnb tabular-nums">
                              <Money value={a.price} /> → <Money value={a.creditAmount} />
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <IconActionButton icon={Pencil} onClick={() => openEdit(a)} label={t.abonements.editAction} />
                            <IconActionButton
                              icon={Trash2}
                              onClick={() => openDeleteAbonementConfirm(a)}
                              label={t.abonements.deleteAbonement}
                              destructive
                            />
                          </div>
                        </div>
                      </SpringCard>
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </>
          )}

          {tab === "wallets" && (
            <>
              <div className="mb-3 flex justify-end">
                <PressableScale>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => setTopupSheetOpen(true)}>
                    <Plus className="size-4" />
                    {t.abonements.addWalletButton}
                  </Button>
                </PressableScale>
              </div>
              <div className="mb-3 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t.abonements.walletsSearchPlaceholder}
                    value={walletQuery}
                    onChange={(e) => {
                      setWalletQuery(e.target.value);
                      loadWallets(e.target.value, walletSort);
                    }}
                    className="h-12 pl-9"
                  />
                </div>
                {/* Сортировка списка (запрос пользователя 2026-07-18: "по
                    балансу, активности и стажу") — фиксированная ширина, не
                    w-auto (та "плыла" уже с самой длинной подписью, сжимая
                    текст в многоточие), и та же высота, что у поля поиска
                    рядом (были разной высоты — "поплыли"). */}
                <Select
                  value={walletSort}
                  onValueChange={(v) => {
                    if (!v) return;
                    const sort = v as typeof walletSort;
                    setWalletSort(sort);
                    loadWallets(walletQuery, sort);
                  }}
                  items={[
                    { value: "recent", label: t.abonements.sortRecent },
                    { value: "balance", label: t.abonements.sortBalance },
                    { value: "activity", label: t.abonements.sortActivity },
                    { value: "tenure", label: t.abonements.sortTenure },
                  ]}
                >
                  <SelectTrigger className="h-12 w-44 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="recent">{t.abonements.sortRecent}</SelectItem>
                    <SelectItem value="balance">{t.abonements.sortBalance}</SelectItem>
                    <SelectItem value="activity">{t.abonements.sortActivity}</SelectItem>
                    <SelectItem value="tenure">{t.abonements.sortTenure}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {wallets.length === 0 ? (
                <p className="text-body-airbnb text-muted-foreground">{t.abonements.noWallets}</p>
              ) : (
                <StaggerList className="flex flex-col gap-3">
                  {wallets.map((w) => (
                    <StaggerItem key={w.id}>
                      {/* Вся карточка кликабельна — сразу в историю/редактирование
                          (запрос пользователя 2026-07-17: "надо иметь возможность
                          войти, чтобы увидеть историю"). Кебаб заменён на 2 прямые
                          кнопки (запрос пользователя 2026-07-20, тот же приём, что
                          в Товарах) — они останавливают всплытие, иначе клик по
                          ним открывал бы ещё и переход по клику самой карточки. */}
                      <SpringCard animate={false} className="cursor-pointer" onClick={() => router.push(`/abonements/${w.id}`)}>
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                            <Wallet className="size-5" />
                          </div>
                          <div className="min-w-0 grow">
                            <div className="text-card-title">{w.name || w.phone}</div>
                            {w.name && <p className="text-caption-airbnb tabular-nums">{w.phone}</p>}
                            <p className="text-caption-airbnb tabular-nums">
                              {t.abonements.balanceLabel}:{" "}
                              <span className="font-bold text-foreground">
                                <Money value={w.balance} />
                              </span>
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <IconActionButton
                              icon={Pencil}
                              onClick={() => router.push(`/abonements/${w.id}`)}
                              label={t.abonements.editAction}
                            />
                            <IconActionButton
                              icon={Trash2}
                              onClick={() => {
                                setWalletKebabTarget(w);
                                setWalletConfirmDelete(true);
                              }}
                              label={t.abonements.deleteWallet}
                              destructive
                            />
                          </div>
                          <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                        </div>
                      </SpringCard>
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </>
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
          {/* Описание механики плана — под полями Цена/Зачислится (запрос
              пользователя 2026-07-18: "размести под полями ввода"), в форме
              создания/редактирования, не на самом табе — справка нужна
              именно в момент заполнения полей. */}
          <p className="-mt-2 text-caption-airbnb text-muted-foreground">{t.abonements.pageSub}</p>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <PressableScale>
            <SaveButton type="submit" className="h-12 w-full" saved={saved} />
          </PressableScale>
        </form>
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
        plans={abonements}
        timezoneEndpoint="/api/tenant/timezone"
        searchEndpoint="/api/abonement-wallets"
        createEndpoint="/api/abonement-wallets"
        topupEndpointFor={(walletId) => `/api/abonement-wallets/${walletId}/topup`}
        updateNameEndpointFor={(walletId) => `/api/abonement-wallets/${walletId}`}
        allowPlanPurchase={false}
        allowArbitraryAmount
        onSuccess={() => loadWallets(walletQuery, walletSort)}
      />

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
