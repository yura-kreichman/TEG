"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ArrowUpDown } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { SpringCard } from "@/components/spring-card";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useI18n } from "@/components/i18n-provider";

type SubscriptionStatus = "active" | "paused" | "suspended" | "expired";

// Вердикт считает сервер (src/lib/admin/tenant-cleanup.ts), а не браузер —
// тот же модуль решает, кого реально разрешено удалить в пачке, и два
// независимых критерия неминуемо разъехались бы при первой правке.
type CleanupVerdict = "deletable" | "abandoned" | "active";

interface TenantInfo {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  package: { id: string; name: string; fluentcartProductId: string | null };
  pointsCount: number;
  operatorsCount: number;
  createdAt: string;
  fluentcartCustomerId: string | null;
  unlimited: boolean;
  cleanupVerdict: CleanupVerdict;
  ageDays: number;
}

// Полный набор фильтров/сортировки (запрос пользователя 2026-07-29: "надо
// делать всё сразу" — не только Free) — package.id, а не имя (переименовать
// пакет не должно ломать фильтр); статус — тот же enum + отдельное значение
// "expiringSoon" (вычисляемый признак поверх active, не отдельный статус в
// БД, см. isExpiringSoon).
type StatusFilter = "all" | SubscriptionStatus | "expiringSoon";
type SortField = "createdAt" | "points" | "operators" | "name";
type SortDir = "asc" | "desc";

const EXPIRING_SOON_DAYS = 7;

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const days = (new Date(dateStr).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}

// Тот же критерий, что решает, показывать ли значок notLinkedChip на
// карточке (см. рендер ниже) — вынесено в функцию, чтобы фильтр "Не
// привязаны к FluentCart" находил РОВНО те же карточки, что помечены
// значком, а не отдельный, чуть разъехавшийся список условий.
function isRealNotLinked(tenant: TenantInfo): boolean {
  return !tenant.fluentcartCustomerId && Boolean(tenant.package.fluentcartProductId) && !tenant.unlimited;
}

export default function AdminTenantsPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [unmatchedWebhookCount, setUnmatchedWebhookCount] = useState(0);
  const [cleanupMinAgeDays, setCleanupMinAgeDays] = useState(60);

  const [packageFilter, setPackageFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [unlimitedOnly, setUnlimitedOnly] = useState(false);
  const [notLinkedOnly, setNotLinkedOnly] = useState(false);
  const [cleanupOnly, setCleanupOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cleanupSheetOpen, setCleanupSheetOpen] = useState(false);
  const [cleanupPassword, setCleanupPassword] = useState("");
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupDone, setCleanupDone] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; skipped: number; failed: number } | null>(null);

  const load = useCallback(() => {
    return fetch("/api/admin/tenants")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/admin/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setTenants(data.tenants ?? []);
        setUnmatchedWebhookCount(data.unmatchedWebhookCount ?? 0);
        if (typeof data.cleanupMinAgeDays === "number") setCleanupMinAgeDays(data.cleanupMinAgeDays);
        setChecking(false);
      });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Список пакетов для фильтра — из реально существующих у тенантов
  // пакетов, не отдельным запросом (тот же набор, что и так уже пришёл).
  const packageOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const tenant of tenants) map.set(tenant.package.id, tenant.package.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [tenants]);

  const displayedTenants = useMemo(() => {
    let list = tenants;
    if (packageFilter !== "all") list = list.filter((tenant) => tenant.package.id === packageFilter);
    if (statusFilter === "expiringSoon") {
      list = list.filter((tenant) => isExpiringSoon(tenant.subscriptionExpiresAt));
    } else if (statusFilter !== "all") {
      list = list.filter((tenant) => tenant.subscriptionStatus === statusFilter);
    }
    if (unlimitedOnly) list = list.filter((tenant) => tenant.unlimited);
    if (notLinkedOnly) list = list.filter(isRealNotLinked);
    if (cleanupOnly) list = list.filter((tenant) => tenant.cleanupVerdict === "deletable");

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === "createdAt") cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortField === "points") cmp = a.pointsCount - b.pointsCount;
      else if (sortField === "operators") cmp = a.operatorsCount - b.operatorsCount;
      else if (sortField === "name") cmp = a.name.localeCompare(b.name, "ru");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [tenants, packageFilter, statusFilter, unlimitedOnly, notLinkedOnly, cleanupOnly, sortField, sortDir]);

  const deletableCount = useMemo(
    () => tenants.filter((tenant) => tenant.cleanupVerdict === "deletable").length,
    [tenants]
  );
  // Выделение живёт только внутри режима очистки, поэтому считаем его по
  // отфильтрованному списку: выключение фильтра снимает выделение (см.
  // toggleCleanupFilter) — иначе можно было бы «унести» галочки в обычный
  // список и удалить не глядя.
  const selectedVisible = useMemo(
    () => displayedTenants.filter((tenant) => selectedIds.has(tenant.id)),
    [displayedTenants, selectedIds]
  );

  function toggleCleanupFilter() {
    setCleanupOnly((on) => {
      if (on) setSelectedIds(new Set());
      return !on;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCleanupSheet() {
    setCleanupPassword("");
    setCleanupError(null);
    setCleanupDone(false);
    setCleanupResult(null);
    setCleanupSheetOpen(true);
  }

  async function confirmCleanup() {
    setCleanupBusy(true);
    setCleanupError(null);
    const res = await fetch("/api/admin/tenants/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedVisible.map((tenant) => tenant.id), password: cleanupPassword }),
    });
    const data = await res.json().catch(() => null);
    setCleanupBusy(false);
    if (!res.ok) {
      setCleanupError(data?.error ?? "Не удалось удалить");
      return;
    }
    setCleanupDone(true);
    setCleanupResult({
      deleted: data?.deleted?.length ?? 0,
      skipped: data?.skipped?.length ?? 0,
      failed: data?.failed?.length ?? 0,
    });
    setSelectedIds(new Set());
    await load();
  }

  if (checking) return null;

  const statusVariant: Record<SubscriptionStatus, "accent" | "warning" | "neutral"> = {
    active: "accent",
    paused: "warning",
    suspended: "warning",
    expired: "neutral",
  };
  const statusLabel: Record<SubscriptionStatus, string> = {
    active: t.admin.statusActive,
    paused: t.admin.statusPaused,
    suspended: t.admin.statusSuspended,
    expired: t.admin.statusExpired,
  };
  const sortFieldLabel: Record<SortField, string> = {
    createdAt: t.admin.sortByCreatedAt,
    points: t.admin.sortByPoints,
    operators: t.admin.sortByOperators,
    name: t.admin.sortByName,
  };

  return (
    <AdminShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <h1 className="text-screen-title">{t.admin.tenantsTitle}</h1>
          <p className="mb-4 text-caption-airbnb">{t.admin.tenantsSub}</p>

          {unmatchedWebhookCount > 0 && (
            <p className="mb-3 text-caption-airbnb font-semibold text-warning">
              {t.admin.unmatchedWebhooksLabel}: {unmatchedWebhookCount}
            </p>
          )}

          {/* Потерянные регистрации (запрос пользователя 2026-08-02). Плашка
              показывается, только когда таким кандидатам реально есть место
              — пустой блок "0 кандидатов" висел бы на экране постоянно и
              ничего не сообщал. Осознанно НЕ вычисляемый предупреждающий
              баннер в духе "у вас проблема" (такие в проекте запрещены) —
              это счётчик и кнопка перехода к списку, без оценок и тревоги. */}
          {deletableCount > 0 && (
            <SpringCard animate={false} className="mb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-card-title">
                    {t.admin.cleanupBannerTitle}: {deletableCount}
                  </div>
                  <p className="text-caption-airbnb">
                    {t.admin.cleanupBannerText.replace("{days}", String(cleanupMinAgeDays))}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={cleanupOnly ? "default" : "outline"}
                  size="sm"
                  className="rounded-lg"
                  onClick={toggleCleanupFilter}
                >
                  {t.admin.cleanupFilter}
                </Button>
              </div>
            </SpringCard>
          )}

          {/* Фильтры + сортировка (запрос пользователя 2026-07-29: "делать
              всё сразу") — пакет/статус выпадающими списками (не растут
              бесконечно с числом пакетов, в отличие от табов), безлимит/
              непривязанность — компактные тумблеры-кнопки, сортировка —
              список полей + отдельная кнопка направления. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              value={packageFilter}
              onValueChange={(v) => v && setPackageFilter(v)}
              items={[{ value: "all", label: t.admin.filterPackageAll }, ...packageOptions.map((pkg) => ({ value: pkg.id, label: pkg.name }))]}
            >
              <SelectTrigger className="h-8 w-auto gap-1.5 px-2.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.admin.filterPackageAll}</SelectItem>
                {packageOptions.map((pkg) => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => v && setStatusFilter(v as StatusFilter)}
              items={[
                { value: "all", label: t.admin.filterStatusAll },
                { value: "active", label: t.admin.statusActive },
                { value: "paused", label: t.admin.statusPaused },
                { value: "suspended", label: t.admin.statusSuspended },
                { value: "expired", label: t.admin.statusExpired },
                { value: "expiringSoon", label: t.admin.statusExpiringSoon },
              ]}
            >
              <SelectTrigger className="h-8 w-auto gap-1.5 px-2.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.admin.filterStatusAll}</SelectItem>
                <SelectItem value="active">{t.admin.statusActive}</SelectItem>
                <SelectItem value="paused">{t.admin.statusPaused}</SelectItem>
                <SelectItem value="suspended">{t.admin.statusSuspended}</SelectItem>
                <SelectItem value="expired">{t.admin.statusExpired}</SelectItem>
                <SelectItem value="expiringSoon">{t.admin.statusExpiringSoon}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sortField}
              onValueChange={(v) => v && setSortField(v as SortField)}
              items={[
                { value: "createdAt", label: sortFieldLabel.createdAt },
                { value: "points", label: sortFieldLabel.points },
                { value: "operators", label: sortFieldLabel.operators },
                { value: "name", label: sortFieldLabel.name },
              ]}
            >
              <SelectTrigger className="h-8 w-auto gap-1.5 px-2.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">{sortFieldLabel.createdAt}</SelectItem>
                <SelectItem value="points">{sortFieldLabel.points}</SelectItem>
                <SelectItem value="operators">{sortFieldLabel.operators}</SelectItem>
                <SelectItem value="name">{sortFieldLabel.name}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="rounded-lg"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label={sortDir === "asc" ? t.admin.sortDirAsc : t.admin.sortDirDesc}
            >
              <ArrowUpDown className={sortDir === "asc" ? "rotate-180" : undefined} />
            </Button>

            <Button
              type="button"
              variant={unlimitedOnly ? "default" : "outline"}
              size="sm"
              className="rounded-lg"
              onClick={() => setUnlimitedOnly((v) => !v)}
            >
              {t.admin.unlimitedChip}
            </Button>
            <Button
              type="button"
              variant={notLinkedOnly ? "default" : "outline"}
              size="sm"
              className="rounded-lg"
              onClick={() => setNotLinkedOnly((v) => !v)}
            >
              {t.admin.notLinkedChip}
            </Button>
            {deletableCount > 0 && (
              <Button
                type="button"
                variant={cleanupOnly ? "default" : "outline"}
                size="sm"
                className="rounded-lg"
                onClick={toggleCleanupFilter}
              >
                {t.admin.cleanupFilter} · {deletableCount}
              </Button>
            )}
          </div>

          {/* Панель выделения — только в режиме очистки. Вне его чекбоксов на
              карточках нет вовсе: массовое удаление должно быть отдельным
              осознанным режимом, а не постоянно доступной кнопкой рядом с
              обычным просмотром списка. */}
          {cleanupOnly && displayedTenants.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() =>
                  setSelectedIds(
                    selectedVisible.length === displayedTenants.length
                      ? new Set()
                      : new Set(displayedTenants.map((tenant) => tenant.id))
                  )
                }
              >
                {selectedVisible.length === displayedTenants.length
                  ? t.admin.cleanupClearSelection
                  : t.admin.cleanupSelectAll}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="rounded-lg"
                disabled={selectedVisible.length === 0}
                onClick={openCleanupSheet}
              >
                {t.admin.cleanupDeleteSelected} · {selectedVisible.length}
              </Button>
            </div>
          )}

          {displayedTenants.length === 0 ? (
            <p className="text-body-airbnb text-muted-foreground">{t.admin.noTenants}</p>
          ) : (
            <StaggerList className="flex flex-col gap-3">
              {displayedTenants.map((tenant) => (
                <StaggerItem key={tenant.id}>
                  <SpringCard animate={false}>
                    {/* Чекбокс вне <Link>: иначе клик по нему уводил бы на
                        карточку тенанта вместо выделения. */}
                    <div className="flex items-center gap-3">
                    {cleanupOnly && (
                      <Checkbox
                        checked={selectedIds.has(tenant.id)}
                        onCheckedChange={() => toggleSelected(tenant.id)}
                        aria-label={tenant.name}
                      />
                    )}
                    <Link href={`/admin/tenants/${tenant.id}`} className="flex grow items-center gap-3">
                      <div className="min-w-0 grow">
                        <div className="flex items-center gap-2">
                          <div className="text-card-title">{tenant.name}</div>
                          <StatusChip variant={statusVariant[tenant.subscriptionStatus]}>
                            {statusLabel[tenant.subscriptionStatus]}
                          </StatusChip>
                          {isExpiringSoon(tenant.subscriptionExpiresAt) && (
                            <StatusChip variant="warning">{t.admin.expiringSoonChip}</StatusChip>
                          )}
                          {/* Только для платных пакетов, у которых нет
                              безлимита (запрос пользователя 2026-07-29:
                              "Free по определению не может быть привязан к
                              FluentCart" + "если безлимит — стоит ли
                              показывать?") — у Free tenant.fluentcartCustomerId
                              всегда пуст, это ожидаемо, не аномалия; у
                              unlimited-тенанта Владелец уже управляется
                              вручную Super Admin'ом в обход биллинга —
                              такая же не-аномалия, тот же критерий, что и
                              isRealNotLinked() для фильтра. */}
                          {isRealNotLinked(tenant) && <StatusChip variant="warning">{t.admin.notLinkedChip}</StatusChip>}
                          {/* Защищён от авто-истечения Free (summary-scheduler.ts,
                              "unlimited: false" в WHERE) — видно прямо в списке,
                              чтобы не спутать с реальным кандидатом на удаление. */}
                          {tenant.unlimited && <StatusChip variant="accent">{t.admin.unlimitedChip}</StatusChip>}
                          {/* Два разных исхода анализа "потерянных клиентов",
                              намеренно разными по весу метками: "подлежит
                              удалению" — пусто, удаление безопасно; "заброшен"
                              — данные есть, это только пометка, в массовое
                              удаление такие не попадают никогда (сервер их
                              отсеивает повторной проверкой). */}
                          {tenant.cleanupVerdict === "deletable" && (
                            <StatusChip variant="warning">{t.admin.cleanupChip}</StatusChip>
                          )}
                          {tenant.cleanupVerdict === "abandoned" && (
                            <StatusChip variant="neutral">{t.admin.cleanupAbandonedChip}</StatusChip>
                          )}
                        </div>
                        {/* Название пакета выделено (запрос пользователя
                            2026-07-29) — при сканировании списка это самое
                            важное поле после статуса, остальное (лимиты)
                            второстепенно. */}
                        <p className="text-caption-airbnb">
                          <span className="font-semibold text-foreground">{tenant.package.name}</span> ·{" "}
                          {tenant.pointsCount} {t.admin.pointsSuffix} · {tenant.operatorsCount}{" "}
                          {t.admin.operatorsSuffix}
                        </p>
                        <p className="text-caption-airbnb text-muted-foreground">
                          {t.admin.registeredOnLabel} {new Date(tenant.createdAt).toLocaleDateString()}
                          {tenant.cleanupVerdict !== "active" && ` · ${tenant.ageDays} ${t.admin.cleanupAgeDays}`}
                        </p>
                      </div>
                      <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
                    </Link>
                    </div>
                  </SpringCard>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </div>
      </div>

      <BottomSheet open={cleanupSheetOpen} onClose={() => setCleanupSheetOpen(false)}>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <h2 className="text-[1.1875rem] font-extrabold tracking-[-0.01em]">{t.admin.cleanupSheetTitle}</h2>
            <p className="mt-1 text-caption-airbnb">
              {t.admin.cleanupSheetText.replace("{count}", String(selectedVisible.length))}
            </p>
          </div>

          {/* Итог показывается вместо формы: после удаления вводить пароль
              заново незачем, а сообщить, что часть записей отсеялась на
              сервере (успели ожить между показом списка и нажатием), нужно
              обязательно — иначе расхождение "выбрал 12, удалилось 11"
              выглядело бы как сбой. */}
          {cleanupResult ? (
            <div className="flex flex-col gap-1 text-body-airbnb">
              <p>{t.admin.cleanupDoneDeleted.replace("{count}", String(cleanupResult.deleted))}</p>
              {cleanupResult.skipped > 0 && (
                <p className="text-muted-foreground">
                  {t.admin.cleanupDoneSkipped.replace("{count}", String(cleanupResult.skipped))}
                </p>
              )}
              {cleanupResult.failed > 0 && (
                <p className="text-destructive">
                  {t.admin.cleanupDoneFailed.replace("{count}", String(cleanupResult.failed))}
                </p>
              )}
              <Button type="button" variant="outline" className="mt-3 h-12" onClick={() => setCleanupSheetOpen(false)}>
                {t.common.close}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="cleanupPassword">{t.admin.cleanupSheetPasswordLabel}</Label>
                <Input
                  id="cleanupPassword"
                  type="password"
                  value={cleanupPassword}
                  onChange={(e) => setCleanupPassword(e.target.value)}
                  autoFocus
                />
              </div>
              {cleanupError && <p className="text-sm text-destructive">{cleanupError}</p>}
              <PressableScale>
                <DeleteButton
                  className="h-12 w-full"
                  disabled={cleanupPassword.trim().length === 0 || cleanupBusy || selectedVisible.length === 0}
                  onClick={confirmCleanup}
                  deleted={cleanupDone}
                >
                  {t.admin.cleanupSheetButton}
                </DeleteButton>
              </PressableScale>
            </>
          )}
        </div>
      </BottomSheet>
    </AdminShell>
  );
}
