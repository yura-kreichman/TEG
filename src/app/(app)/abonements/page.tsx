"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2, Gift, Search, ChevronLeft, ChevronRight, Wallet, Send, Megaphone, FileDown, FileUp, QrCode as QrCodeIcon, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { FilePickerButton } from "@/components/file-picker-button";
import { compressImageFile } from "@/lib/client-image";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { parseMoneyInput } from "@/lib/format";
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
import { InstructionQrSheet } from "@/components/instructions/instruction-qr-sheet";
import { useI18n } from "@/components/i18n-provider";
import { useSavePulse } from "@/hooks/use-save-pulse";
import { cn } from "@/lib/utils";
import {
  formatSalesPeriodLabel,
  isSalesPeriodCurrent,
  salesPeriodDateStr,
  salesPeriodRange,
  stepSalesPeriodAnchor,
  type SalesPeriodGranularity,
} from "@/lib/sales-period";

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
  hasTelegram: boolean;
}

// Строка реестра продаж (таб "Продажи", /api/abonement-sales). paidAmount —
// уплаченные деньги, creditedAmount — начисленное на баланс: у плана с
// бонусом это разные числа. paidAmount = null у продаж старше 2026-08-16,
// которые не удалось связать с деньгами при бэкфилле.
interface SaleInfo {
  id: string;
  occurredAt: string;
  // "adjustment" — начисление владельцем из кабинета: без плана и без денег,
  // но баланс клиента меняет так же, поэтому живёт в том же реестре.
  kind: "sale" | "adjustment";
  planName: string | null;
  creditedAmount: number;
  paidAmount: number | null;
  paymentMethod: string | null;
  walletId: string;
  clientName: string | null;
  clientPhone: string;
  walletBalance: number;
  pointName: string | null;
  performedBy: string | null;
  performedByOwner: boolean;
  performedByColorTag: string | null;
  voidedAt: string | null;
}

// Разбор файла импорта — счётчики и проблемные строки (см.
// /api/abonement-wallets/import, шаг предпросмотра).
interface ImportPreview {
  newCount: number;
  errorCount: number;
  existingCount: number;
  duplicateCount: number;
  problems: { line: number; phone: string; name: string | null; error: string }[];
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
  // Третий таб "Продажи" (запрос владельца 2026-08-16) — реестр проданных
  // абонементов: до него правка продажи была невозможна нигде, а Итоги дня
  // показывали список только за один день и без действий. Открывается и
  // ссылкой (?tab=sales) — из Итогов дня туда ведёт стрелка в заголовке.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"wallets" | "abonements" | "sales">(() => {
    const requested = searchParams.get("tab");
    return requested === "abonements" || requested === "sales" ? requested : "wallets";
  });

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
  // Сводка счётчиков (запрос пользователя 2026-07-28) — независимо от
  // текущего поиска/фильтра списка, настоящие агрегаты по всей базе
  // клиентов тенанта (см. /api/abonement-wallets/list, поле counts).
  const [walletCounts, setWalletCounts] = useState<{ total: number; connected: number; withBalance: number } | null>(
    null
  );
  const [walletQuery, setWalletQuery] = useState("");
  // Сортировка списка абонентов (запрос пользователя 2026-07-18: "по
  // балансу, активности и стажу") — "recent" (по умолчанию, недавно
  // созданные сверху) не показывается отдельным пунктом в переключателе,
  // это его исходное состояние.
  const [walletSort, setWalletSort] = useState<"recent" | "balance" | "activity" | "tenure" | "telegram">("recent");
  const [walletKebabTarget, setWalletKebabTarget] = useState<WalletInfo | null>(null);
  const [walletConfirmDelete, setWalletConfirmDelete] = useState(false);
  const { saved: walletDeleted, pulse: walletDeletePulse } = useSavePulse();

  // Рассылка клиентам, подключившим Telegram-бота (запрос пользователя
  // 2026-07-23) — без отдельного тумблера-разрешения ("в глобальных
  // настройках не нужна такая опция", явное решение пользователя), метка
  // "📣" в самом тексте сообщения (см. /api/abonement-wallets/broadcast)
  // отличает рассылку от транзакционных уведомлений бота.
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastImageUrl, setBroadcastImageUrl] = useState<string | null>(null);
  const [broadcastImageUploading, setBroadcastImageUploading] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number; total: number; groupSent: boolean | null } | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  // Импорт клиентов при переезде с другого ПО (запрос пользователя 2026-08-02).
  // Файл держим в состоянии до конца: шаг записи отправляет его повторно —
  // сервер разбирает файл заново и не верит разобранным строкам из браузера
  // (иначе можно было бы прислать себе любые балансы в обход проверок).
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);
  // Адресат рассылки — "в группу" доступен только когда публичная группа
  // подключена и включена (запрос пользователя 2026-07-24: "только если она
  // настроена"), иначе выбор вообще не показываем (нечего выбирать).
  const [broadcastDestination, setBroadcastDestination] = useState<"all" | "clients" | "group">("all");
  const [publicGroupReady, setPublicGroupReady] = useState(false);

  // Общий QR (не привязан к конкретному клиенту) — Владелец показывает его
  // новому клиенту прямо на месте, чтобы тот отсканировал и подключил бота
  // сам (запрос пользователя 2026-07-25), тот же tenant-scoped deep link, что
  // уже используется в карточке конкретного клиента — /api/tenant/telegram-balance-link
  // без ?phone= отдаёт именно его, никакой отдельной ручки не нужно.
  const [genericQrOpen, setGenericQrOpen] = useState(false);
  const [telegramBalanceLink, setTelegramBalanceLink] = useState<string | null>(null);

  // Таб "Продажи" (запрос владельца 2026-08-16).
  const [sales, setSales] = useState<SaleInfo[]>([]);
  const [salesTotals, setSalesTotals] = useState<{ count: number; paid: number; credited: number } | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  // Фильтры — тот же набор и тот же вид, что в реестре продаж Товаров
  // (запрос владельца 2026-08-16): период, точка, сотрудник, поиск клиента.
  const [salesMode, setSalesMode] = useState<"granularity" | "custom">("granularity");
  const [salesGranularity, setSalesGranularity] = useState<SalesPeriodGranularity>("month");
  const [salesAnchor, setSalesAnchor] = useState(() => new Date());
  const [salesCustomFrom, setSalesCustomFrom] = useState(() => salesPeriodDateStr(new Date()));
  const [salesCustomTo, setSalesCustomTo] = useState(() => salesPeriodDateStr(new Date()));
  const [salesPointFilter, setSalesPointFilter] = useState<string>("all");
  const [salesPerformerFilter, setSalesPerformerFilter] = useState<string>("all");
  const [salesQuery, setSalesQuery] = useState("");
  const [salesPoints, setSalesPoints] = useState<{ id: string; name: string }[]>([]);
  const [salesOperators, setSalesOperators] = useState<{ id: string; name: string }[]>([]);
  const [voidTarget, setVoidTarget] = useState<SaleInfo | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const { saved: voided, pulse: voidPulse } = useSavePulse();

  async function handleBroadcastImageUpload(file: File) {
    setBroadcastImageUploading(true);
    setBroadcastError(null);
    try {
      const compressed = await compressImageFile(file);
      const formData = new FormData();
      formData.append("file", compressed);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setBroadcastError(data.error ?? t.abonements.broadcastError);
        return;
      }
      setBroadcastImageUrl(data.url);
    } finally {
      setBroadcastImageUploading(false);
    }
  }

  async function sendBroadcast() {
    setBroadcastSending(true);
    setBroadcastError(null);
    try {
      const res = await fetch("/api/abonement-wallets/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: broadcastMessage.trim(),
          imageUrl: broadcastImageUrl,
          destination: publicGroupReady ? broadcastDestination : "clients",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBroadcastError(data.error ?? t.abonements.broadcastError);
        return;
      }
      setBroadcastResult({ sent: data.sent, total: data.total, groupSent: data.groupSent });
      setBroadcastMessage("");
      setBroadcastImageUrl(null);
    } finally {
      setBroadcastSending(false);
    }
  }

  function openImportSheet() {
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportOpen(true);
  }

  // Шаг 1 — разбор без записи. Владелец видит, что именно поняла система,
  // до того как что-то попадёт в базу: чужая выгрузка легко приезжает со
  // сдвинутыми колонками или мусором вместо номеров.
  async function previewImport(file: File) {
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportBusy(true);

    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/abonement-wallets/import", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    setImportBusy(false);

    if (!res.ok) {
      setImportError(data?.error ?? t.abonements.importFailed);
      return;
    }
    setImportPreview(data);
  }

  // Шаг 2 — та же ручка с commit=1 и тем же файлом.
  async function commitImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportError(null);

    const form = new FormData();
    form.append("file", importFile);
    form.append("commit", "1");
    const res = await fetch("/api/abonement-wallets/import", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    setImportBusy(false);

    if (!res.ok) {
      setImportError(data?.error ?? t.abonements.importFailed);
      return;
    }
    setImportResult(data);
    await loadWallets();
  }

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
    if (data.counts) setWalletCounts(data.counts);
  }

  // Реестр продаж — грузится только при открытии своего таба: владелец чаще
  // заходит в Клиенты за поиском абонента, лишний запрос на каждый визит ни
  // к чему.
  async function loadSales() {
    setSalesLoading(true);
    try {
      const params = new URLSearchParams();
      const range =
        salesMode === "custom"
          ? { from: salesCustomFrom, to: salesCustomTo }
          : salesPeriodRange(salesGranularity, salesAnchor);
      params.set("from", range.from);
      params.set("to", range.to);
      if (salesPointFilter !== "all") params.set("pointId", salesPointFilter);
      if (salesPerformerFilter !== "all") params.set("performedBy", salesPerformerFilter);
      if (salesQuery.trim()) params.set("q", salesQuery.trim());
      const res = await fetch(`/api/abonement-sales?${params.toString()}`);
      const data = await res.json();
      setSales(data.sales ?? []);
      setSalesTotals(data.totals ?? null);
    } finally {
      setSalesLoading(false);
    }
  }

  async function voidSale() {
    if (!voidTarget || voiding) return;
    setVoiding(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/abonement-sales/${voidTarget.id}/void`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // Текст ошибки приходит с сервера (например, "продажа уже
        // аннулирована"); общего запасного ключа в словаре нет — при пустом
        // ответе показываем заголовок действия, а не пустую строку.
        setVoidError(data?.error ?? t.abonements.saleVoidAction);
        return;
      }
      await loadSales();
      // Балансы клиентов изменились — список кошельков рядом не должен
      // показывать старые цифры.
      await loadWallets(walletQuery, walletSort);
      voidPulse(() => setVoidTarget(null));
    } finally {
      setVoiding(false);
    }
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
    fetch("/api/tenant/telegram-balance-link")
      .then((res) => res.json())
      .then((data) => setTelegramBalanceLink(data.link ?? null))
      .catch(() => {});
    fetch("/api/tenant/public-group/telegram/status")
      .then((res) => res.json())
      .then((data) => setPublicGroupReady(!!data.connected && data.enabled !== false))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab !== "sales") return;
    loadSales();
    // Точки и сотрудники для селектов — один раз при первом открытии таба.
    if (salesPoints.length === 0) {
      fetch("/api/points")
        .then((res) => res.json())
        .then((data) => setSalesPoints(data.points ?? []))
        .catch(() => {});
    }
    if (salesOperators.length === 0) {
      fetch("/api/operators")
        .then((res) => res.json())
        .then((data) => setSalesOperators((data.operators ?? []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name }))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, salesMode, salesGranularity, salesAnchor, salesCustomFrom, salesCustomTo, salesPointFilter, salesPerformerFilter]);

  // Поиск — с задержкой, чтобы не бить в API на каждую букву (тот же приём,
  // что в списке клиентов рядом).
  useEffect(() => {
    if (tab !== "sales") return;
    const timer = setTimeout(() => loadSales(), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesQuery]);
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
    const price = parseMoneyInput(form.price);
    const creditAmount = parseMoneyInput(form.creditAmount);
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
            className="mb-4 grid grid-cols-3"
            equalWidth
            size="sm"
            options={[
              { key: "wallets", label: t.abonements.walletsTitle },
              { key: "abonements", label: t.abonements.title },
              { key: "sales", label: t.abonements.salesTab },
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

          {/* Реестр продаж абонементов (запрос владельца 2026-08-16). Правки
              тут нет и не будет: продажа связывает деньги и начисленный
              баланс прайсом плана, и менять одно без другого — значит
              оставить запись, которую нечем объяснить. Ошибку исправляют
              аннулированием и продажей заново. */}
          {tab === "sales" && (
            <>
              {/* Период — те же пять кнопок, что в Товарах и Деньгах. */}
              <div className="mb-3 grid grid-cols-5 gap-1">
                {(["day", "week", "month", "year"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setSalesGranularity(g);
                      setSalesAnchor(new Date());
                      setSalesMode("granularity");
                    }}
                    className={cn(
                      "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                      salesMode === "granularity" && g === salesGranularity
                        ? "bg-primary/10 text-primary"
                        : "bg-surface-0 text-muted-foreground"
                    )}
                  >
                    {g === "day"
                      ? t.money.periodDay
                      : g === "week"
                        ? t.money.periodWeek
                        : g === "month"
                          ? t.money.periodMonth
                          : t.money.periodYear}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSalesMode("custom")}
                  className={cn(
                    "rounded-full px-1 py-1.5 text-center text-[0.6875rem] font-semibold sm:text-xs",
                    salesMode === "custom" ? "bg-primary/10 text-primary" : "bg-surface-0 text-muted-foreground"
                  )}
                >
                  {t.money.periodCustom}
                </button>
              </div>

              {salesMode === "granularity" ? (
                <div className="mb-3 flex items-center justify-between">
                  <button
                    type="button"
                    aria-label={t.money.prevPeriod}
                    onClick={() => setSalesAnchor(stepSalesPeriodAnchor(salesGranularity, salesAnchor, -1))}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground"
                  >
                    <ChevronLeft className="size-4.5" />
                  </button>
                  <p className="text-caption-airbnb font-semibold text-foreground">
                    {formatSalesPeriodLabel(salesGranularity, salesAnchor, t)}
                  </p>
                  <button
                    type="button"
                    aria-label={t.money.nextPeriod}
                    onClick={() => setSalesAnchor(stepSalesPeriodAnchor(salesGranularity, salesAnchor, 1))}
                    disabled={isSalesPeriodCurrent(salesGranularity, salesAnchor)}
                    className="flex size-8 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
                  >
                    <ChevronRight className="size-4.5" />
                  </button>
                </div>
              ) : (
                <div className="mb-3 flex items-center gap-2">
                  <input
                    type="date"
                    value={salesCustomFrom}
                    max={salesCustomTo}
                    onChange={(e) => setSalesCustomFrom(e.target.value)}
                    className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                  />
                  <span className="text-caption-airbnb text-muted-foreground">—</span>
                  <input
                    type="date"
                    value={salesCustomTo}
                    min={salesCustomFrom}
                    onChange={(e) => setSalesCustomTo(e.target.value)}
                    className="h-9 flex-1 rounded-control border border-input bg-background px-2.5 text-caption-airbnb"
                  />
                </div>
              )}

              <div className="mb-3 flex flex-col gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={salesQuery}
                    onChange={(e) => setSalesQuery(e.target.value)}
                    placeholder={t.abonements.walletsSearchPlaceholder}
                    className="pl-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {/* Точка — только когда их больше одной: на одиночной
                      точке селект выбирать нечего. */}
                  {salesPoints.length > 1 && (
                    <Select
                      value={salesPointFilter}
                      onValueChange={(v) => v && setSalesPointFilter(v)}
                      items={[
                        { value: "all", label: t.money.allPoints },
                        ...salesPoints.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    >
                      <SelectTrigger className="h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.money.allPoints}</SelectItem>
                        {salesPoints.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select
                    value={salesPerformerFilter}
                    onValueChange={(v) => v && setSalesPerformerFilter(v)}
                    items={[
                      { value: "all", label: t.goods.allOperatorsLabel },
                      { value: "owner", label: t.common.ownerLabel },
                      ...salesOperators.map((o) => ({ value: o.id, label: o.name })),
                    ]}
                  >
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.goods.allOperatorsLabel}</SelectItem>
                      {/* Владелец отдельным пунктом: его начисления и продажи
                          не привязаны ни к какому сотруднику. */}
                      <SelectItem value="owner">{t.common.ownerLabel}</SelectItem>
                      {salesOperators.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {salesTotals && salesTotals.count > 0 && (
                <SpringCard hover={false} className="mb-3.5">
                  <div className="flex items-baseline justify-between gap-2 tabular-nums">
                    <span className="text-caption-airbnb text-muted-foreground">
                      {t.abonements.salesTab} · {salesTotals.count}
                    </span>
                    <span className="text-[1.375rem] font-extrabold">
                      <Money value={salesTotals.paid} />
                    </span>
                  </div>
                  <p className="text-caption-airbnb text-muted-foreground">
                    {t.abonements.saleCreditedLabel}: <Money value={salesTotals.credited} />
                  </p>
                </SpringCard>
              )}

              {salesLoading ? (
                <SkeletonListRows count={4} />
              ) : sales.length === 0 ? (
                <p className="text-body-airbnb text-muted-foreground">{t.abonements.noSales}</p>
              ) : (
                <StaggerList className="flex flex-col gap-3.5">
                  {sales.map((s) => (
                    <StaggerItem key={s.id}>
                      <SpringCard animate={false} className={cn(s.voidedAt && "opacity-60")}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 grow">
                            <div className="flex items-center gap-1.5">
                              {/* Начисление владельцем — без плана и без
                                  денег, поэтому подписано своим ярлыком, а не
                                  выдуманным названием абонемента. */}
                              <p className="truncate text-card-title">
                                {s.kind === "adjustment"
                                  ? t.abonements.arbitraryAmountTitle
                                  : (s.planName ?? t.abonements.title)}
                              </p>
                              {s.voidedAt && (
                                <span className="shrink-0 text-caption-airbnb text-destructive">
                                  {t.abonements.saleVoided}
                                </span>
                              )}
                            </div>
                            <p className="flex flex-wrap items-center gap-x-1.5 text-caption-airbnb text-muted-foreground">
                              <span className="tabular-nums">{new Date(s.occurredAt).toLocaleString()}</span>
                              <span>· {s.clientName ?? s.clientPhone}</span>
                              {s.pointName && <span>· {s.pointName}</span>}
                            </p>
                            <p className="flex flex-wrap items-center gap-x-1.5 text-caption-airbnb text-muted-foreground">
                              {(s.performedBy || s.performedByOwner) && (
                                <span className="inline-flex items-center gap-1">
                                  <Users className="size-3.5 shrink-0" />
                                  {s.performedBy}
                                </span>
                              )}
                              {/* Начислено и уплачено — разные суммы, когда у
                                  плана есть бонус; показываем обе, иначе
                                  непонятно, почему в кассе меньше. */}
                              <span>
                                · {t.abonements.saleCreditedLabel}: <Money value={s.creditedAmount} />
                              </span>
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="font-bold tabular-nums">
                              {s.paidAmount === null ? "—" : <Money value={s.paidAmount} />}
                            </span>
                            {!s.voidedAt && (
                              <IconActionButton
                                icon={Trash2}
                                onClick={() => {
                                  setVoidError(null);
                                  setVoidTarget(s);
                                }}
                                label={t.abonements.saleVoidAction}
                                destructive
                              />
                            )}
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
              {/* Сводка счётчиков (запрос пользователя 2026-07-28) — всегда
                  про всю базу клиентов тенанта, не про текущий
                  поиск/фильтр списка ниже (см. walletCounts). По одной
                  строке (реальный баг, найден пользователем 2026-07-28:
                  в один ряд длинные подписи переносились и "кривило" всю
                  строку). Число — сразу после двоеточия (запрос того же
                  дня), не растянуто через justify-between на весь ряд.
                  Иконки — та же семантика, что и у per-карточки: Wallet у
                  клиента с балансом, Send у подключённых через Telegram. */}
              {/* QR — в том же ряду, что сводка счётчиков, справа (запрос
                  пользователя 2026-07-28), крупнее прежнего (icon-sm ->
                  icon-lg) — ml-auto прижимает его к правому краю независимо
                  от того, успела ли уже загрузиться сводка (walletCounts
                  может быть ещё null в момент первого рендера). */}
              <div className="mb-3 flex items-center justify-between gap-3">
                {walletCounts && (
                  <div className="flex flex-col gap-1.5 text-caption-airbnb text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5 shrink-0" />
                      {t.abonements.walletsCountTotal}{" "}
                      <span className="font-semibold text-foreground">{walletCounts.total}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Send className="size-3.5 shrink-0" />
                      {t.abonements.walletsCountConnected}{" "}
                      <span className="font-semibold text-foreground">{walletCounts.connected}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Wallet className="size-3.5 shrink-0" />
                      {t.abonements.walletsCountWithBalance}{" "}
                      <span className="font-semibold text-foreground">{walletCounts.withBalance}</span>
                    </span>
                  </div>
                )}
                {/* Общий QR для нового клиента — показать/дать отсканировать
                    на месте, без поиска его в списке (запрос пользователя
                    2026-07-25). Не показываем, если бот вообще не настроен
                    (telegramBalanceLink тогда null) — тот же принцип, что и у
                    кнопки в карточке конкретного клиента. */}
                {telegramBalanceLink && (
                  <PressableScale className="ml-auto shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      className="rounded-lg"
                      aria-label={t.abonements.telegramBalanceButton}
                      onClick={() => setGenericQrOpen(true)}
                    >
                      <QrCodeIcon className="size-5" />
                    </Button>
                  </PressableScale>
                )}
              </div>
              <div className="mb-3 flex justify-end gap-2">
                {/* Экспорт клиентов в CSV (запрос пользователя 2026-07-27) —
                    Name/Phone/Balance, телефон с "+" (см. export/route.ts). */}
                <PressableScale>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="rounded-lg"
                    aria-label={t.abonements.exportButton}
                    onClick={() => {
                      window.location.href = "/api/abonement-wallets/export";
                    }}
                  >
                    <FileDown className="size-4" />
                  </Button>
                </PressableScale>
                {/* Импорт клиентов при переезде с другого ПО (запрос
                    пользователя 2026-08-02) — рядом с экспортом, тот же
                    формат файла. Иконкой, как экспорт: действие редкое,
                    занимать словом место в этой строке незачем. */}
                <PressableScale>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="rounded-lg"
                    aria-label={t.abonements.importButton}
                    onClick={openImportSheet}
                  >
                    <FileUp className="size-4" />
                  </Button>
                </PressableScale>
                <PressableScale>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 rounded-lg"
                    onClick={() => {
                      setBroadcastResult(null);
                      setBroadcastError(null);
                      setBroadcastOpen(true);
                    }}
                  >
                    <Megaphone className="size-4" />
                    {t.abonements.broadcastButton}
                  </Button>
                </PressableScale>
                <PressableScale>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => setTopupSheetOpen(true)}>
                    <Plus className="size-4" />
                    {t.abonements.addWalletButton}
                  </Button>
                </PressableScale>
              </div>
              {/* На мобильном — в столбик (запрос пользователя 2026-07-27:
                  на узких экранах вдвоём в одной строке текст поиска
                  обрезался до "Поиск по теле..."), с sm: — снова в строку. */}
              <div className="mb-3 flex flex-col gap-2 sm:flex-row">
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
                    { value: "telegram", label: t.abonements.sortTelegram },
                  ]}
                >
                  <SelectTrigger className="h-12 w-full sm:w-44 sm:shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="recent">{t.abonements.sortRecent}</SelectItem>
                    <SelectItem value="balance">{t.abonements.sortBalance}</SelectItem>
                    <SelectItem value="activity">{t.abonements.sortActivity}</SelectItem>
                    <SelectItem value="tenure">{t.abonements.sortTenure}</SelectItem>
                    <SelectItem value="telegram">{t.abonements.sortTelegram}</SelectItem>
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
                            <div className="flex items-center gap-1.5 text-card-title">
                              <span className="truncate">{w.name || w.phone}</span>
                              {/* Подключил бота RentOS в Telegram (запрос пользователя
                                  2026-07-23) — только индикатор, не кнопка. */}
                              {w.hasTelegram && (
                                <Send className="size-3.5 shrink-0 text-primary" aria-label={t.abonements.telegramLinkedLabel} />
                              )}
                            </div>
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
          {walletKebabTarget && walletKebabTarget.balance !== 0 && (
            <p className="flex items-center gap-1.5 text-body-airbnb font-semibold text-destructive">
              {t.abonements.confirmDeleteWalletBalanceWarning} <Money value={walletKebabTarget.balance} />
            </p>
          )}
          <PressableScale>
            <DeleteButton className="h-12 w-full" onClick={deleteWallet} deleted={walletDeleted} />
          </PressableScale>
        </div>
      </BottomSheet>

      {/* Аннулирование продажи. Предупреждение о минусе — не запрет
          (решение владельца 2026-08-16): клиент мог уже потратить эти
          деньги, но запрет означал бы, что ошибочную продажу нельзя
          отменить вовсе. Тот же принцип, что у зонной инкассации в минус. */}
      <BottomSheet open={voidTarget !== null} onClose={() => setVoidTarget(null)}>
        {voidTarget && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.abonements.saleVoidTitle}</h2>
            <p className="text-body-airbnb">{t.abonements.saleVoidText}</p>
            {voidTarget.walletBalance - voidTarget.creditedAmount < 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-body-airbnb font-semibold text-destructive">
                {t.abonements.saleVoidNegativeWarning}{" "}
                <Money value={Math.round((voidTarget.walletBalance - voidTarget.creditedAmount) * 100) / 100} />
              </p>
            )}
            {voidError && <p className="text-body-airbnb text-destructive">{voidError}</p>}
            <PressableScale>
              <DeleteButton className="h-12 w-full" onClick={voidSale} deleted={voided} />
            </PressableScale>
          </div>
        )}
      </BottomSheet>

      {telegramBalanceLink && (
        <InstructionQrSheet
          open={genericQrOpen}
          onClose={() => setGenericQrOpen(false)}
          title={t.abonements.telegramConnectSheetTitle}
          url={telegramBalanceLink}
        />
      )}

      <BottomSheet open={importOpen} onClose={() => setImportOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.abonements.importSheetTitle}</h2>
            <p className="mt-1 text-caption-airbnb">{t.abonements.importSheetHint}</p>
          </div>

          {importResult ? (
            <div className="flex flex-col gap-1 text-body-airbnb">
              <p>{t.abonements.importDoneCreated.replace("{count}", String(importResult.created))}</p>
              {importResult.skipped > 0 && (
                <p className="text-muted-foreground">
                  {t.abonements.importDoneSkipped.replace("{count}", String(importResult.skipped))}
                </p>
              )}
              <Button type="button" variant="outline" className="mt-3 h-12" onClick={() => setImportOpen(false)}>
                {t.common.close}
              </Button>
            </div>
          ) : (
            <>
              {/* Образец — первым, до выбора файла: он и нужен тому, кто ещё
                  не знает, как оформить выгрузку из старой системы. */}
              <PressableScale>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full gap-2"
                  onClick={() => {
                    window.location.href = "/api/abonement-wallets/import/template";
                  }}
                >
                  <FileDown className="size-4" />
                  {t.abonements.importTemplateButton}
                </Button>
              </PressableScale>

              <div className="flex flex-col gap-1">
                <FilePickerButton
                  accept=".xlsx,.csv"
                  icon={FileUp}
                  hasFile={Boolean(importFile)}
                  disabled={importBusy}
                  onFileSelected={previewImport}
                  className="w-full"
                />
                {importFile && <span className="text-caption-airbnb">{importFile.name}</span>}
              </div>

              {importPreview && (
                <div className="flex flex-col gap-1 text-body-airbnb">
                  <p className="font-semibold">
                    {t.abonements.importPreviewNew.replace("{count}", String(importPreview.newCount))}
                  </p>
                  {importPreview.existingCount > 0 && (
                    <p className="text-muted-foreground">
                      {t.abonements.importPreviewExisting.replace("{count}", String(importPreview.existingCount))}
                    </p>
                  )}
                  {importPreview.duplicateCount > 0 && (
                    <p className="text-muted-foreground">
                      {t.abonements.importPreviewDuplicates.replace("{count}", String(importPreview.duplicateCount))}
                    </p>
                  )}
                  {importPreview.errorCount > 0 && (
                    <p className="text-destructive">
                      {t.abonements.importPreviewErrors.replace("{count}", String(importPreview.errorCount))}
                    </p>
                  )}
                  {/* Номер строки — чтобы владелец нашёл её в своём Excel, а
                      не искал вслепую по телефону. */}
                  {importPreview.problems.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 text-caption-airbnb text-muted-foreground">
                      {importPreview.problems.map((p) => (
                        <li key={p.line}>
                          {t.abonements.importLinePrefix} {p.line}: {p.phone || "—"} —{" "}
                          {p.error === "phone"
                            ? t.abonements.importErrorPhone
                            : p.error === "balance"
                              ? t.abonements.importErrorBalance
                              : p.error === "duplicateInFile"
                                ? t.abonements.importErrorDuplicate
                                : t.abonements.importErrorExists}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {importError && <p className="text-sm text-destructive">{importError}</p>}

              <PressableScale>
                <Button
                  type="button"
                  className="h-12 w-full"
                  disabled={importBusy || !importPreview || importPreview.newCount === 0}
                  onClick={commitImport}
                >
                  {importPreview
                    ? t.abonements.importSubmit.replace("{count}", String(importPreview.newCount))
                    : t.abonements.importSubmitEmpty}
                </Button>
              </PressableScale>
            </>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={broadcastOpen} onClose={() => setBroadcastOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.abonements.broadcastButton}</h2>
          <p className="text-caption-airbnb text-muted-foreground">{t.abonements.broadcastHint}</p>

          {/* "В группу" только когда публичная группа подключена и включена
              (запрос пользователя 2026-07-24: "только если она настроена") —
              без группы выбирать вообще не из чего, весь блок скрыт, старое
              поведение (только клиентам) не меняется. */}
          {publicGroupReady && (
            <SegmentedTabs
              equalWidth
              size="sm"
              options={[
                { key: "all", label: t.abonements.broadcastDestinationAll },
                { key: "clients", label: t.abonements.broadcastDestinationClients },
                { key: "group", label: t.abonements.broadcastDestinationGroup },
              ]}
              value={broadcastDestination}
              onChange={setBroadcastDestination}
            />
          )}

          <div className="flex flex-col gap-1">
            <Label>{t.abonements.broadcastImageLabel}</Label>
            <div className="flex flex-wrap items-center gap-3">
              {broadcastImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={broadcastImageUrl} alt="" className="size-12 rounded-control object-cover" />
              )}
              <PressableScale>
                <FilePickerButton
                  accept="image/jpeg,image/png,image/webp"
                  onFileSelected={handleBroadcastImageUpload}
                  disabled={broadcastImageUploading}
                  hasFile={!!broadcastImageUrl}
                />
              </PressableScale>
              {broadcastImageUrl && (
                <button
                  type="button"
                  className="text-caption-airbnb font-semibold text-destructive"
                  onClick={() => setBroadcastImageUrl(null)}
                >
                  {t.common.delete}
                </button>
              )}
            </div>
          </div>

          <Textarea
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
            placeholder={t.abonements.broadcastPlaceholder}
            rows={5}
            maxLength={900}
          />
          {broadcastError && <p className="text-sm text-destructive">{broadcastError}</p>}
          {broadcastResult && (
            <div className="flex flex-col gap-0.5">
              {(broadcastDestination === "all" || broadcastDestination === "clients") && (
                <p className="text-body-airbnb text-success">
                  {t.abonements.broadcastSentPrefix} {broadcastResult.sent} / {broadcastResult.total}
                </p>
              )}
              {(broadcastDestination === "all" || broadcastDestination === "group") && (
                <p className={cn("text-body-airbnb", broadcastResult.groupSent ? "text-success" : "text-destructive")}>
                  {broadcastResult.groupSent ? t.abonements.broadcastGroupSent : t.abonements.broadcastGroupFailed}
                </p>
              )}
            </div>
          )}
          <PressableScale>
            <Button
              type="button"
              className="h-12 w-full"
              disabled={broadcastSending || !broadcastMessage.trim()}
              onClick={sendBroadcast}
            >
              {broadcastSending ? t.abonements.broadcastSending : t.abonements.broadcastSendButton}
            </Button>
          </PressableScale>
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
