import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { verifyPassword } from "@/lib/auth";

// Категории очистки (докс: фидбек пользователя 2026-07-09). MoneyOperation
// не имеет реальных FK на ResultsSubmission/Shift (resultsSubmissionId/shiftId —
// свободные строки, см. схему) — каскада нет, поэтому связанные операции
// журнала денег удаляются явно вместе с "родителем", иначе останутся висящие
// записи выручки/расходов/авансов без источника.
export const CLEANUP_CATEGORIES = ["results", "collections", "shifts", "change_fund", "goods", "clients", "all"] as const;
export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];

function isCleanupCategory(value: unknown): value is CleanupCategory {
  return typeof value === "string" && (CLEANUP_CATEGORIES as readonly string[]).includes(value);
}

async function cleanupResults(tenantId: string) {
  // Launch.zoneSubmissionId — свободная ссылка без формального @relation
  // (см. схему, комментарий у Launch), поэтому НЕ каскадируется при удалении
  // ResultsSubmission/ZoneSubmission ниже — без явного удаления здесь пуски
  // "Прибываний"/"Пусков" (accountingMode="stays"/"launches") переживали
  // очистку целиком, и их выручка продолжала считаться в отчётах (реальный
  // баг, найден пользователем 2026-07-19: очистка выглядела так, будто
  // стёрлись данные только по одной точке — на деле стирались только зоны
  // режима "Счётчики", Прибывания/Пуски оставались нетронутыми). AbonementTransaction.launchId
  // — настоящий @relation с onDelete: SetNull, баланс кошелька клиента и
  // история его пополнений/трат не затрагиваются, только ссылка на удалённый
  // пуск.
  await prisma.launch.deleteMany({ where: { zone: { point: { tenantId } } } });
  // revenue_abonement — тоже создаётся сразу при оплате пуска абонементом
  // (src/lib/abonement.ts), а не при сдаче итогов, поэтому у него никогда
  // нет resultsSubmissionId — без OR ниже эта выручка тоже переживала
  // очистку (тот же баг). revenue/revenue_cashless БЕЗ resultsSubmissionId
  // (аудит 2026-07-25, финальный проход) — тот же класс: voidTicketInTx
  // (lib/tickets.ts) переиспользует ЭТИ ЖЕ типы отрицательной суммой при
  // аннулировании билета ПОСЛЕ сдачи итогов, но без resultsSubmissionId —
  // submit-results/route.ts единственный, кто создаёт revenue/revenue_cashless
  // с ним, поэтому "тип revenue* без resultsSubmissionId" однозначно
  // означает такой возврат, безопасно захватывать в очистку.
  await prisma.moneyOperation.deleteMany({
    where: {
      tenantId,
      OR: [
        { resultsSubmissionId: { not: null } },
        { type: "revenue_abonement" },
        { type: { in: ["revenue", "revenue_cashless"] }, resultsSubmissionId: null },
      ],
    },
  });
  await prisma.resultsSubmission.deleteMany({ where: { tenantId } });
}

async function cleanupCollections(tenantId: string) {
  // Все формы "Инкассации" (docs/spec/02-money.md) — не только сам
  // "collection", иначе очистка оставляла бы висящие записи Аванса
  // инкассации/его погашения и абонементных/товарных свипов без источника
  // (найдено при добавлении advance_settlement 2026-07-25 — то же упущение
  // уже было и для collection_advance/collection_pool_sweep_* с 2026-07-22,
  // расширяю заодно).
  await prisma.moneyOperation.deleteMany({
    where: {
      tenantId,
      type: {
        in: [
          "collection",
          "advance_settlement",
          "collection_advance",
          "collection_pool_sweep_abonement",
          "collection_pool_sweep_goods",
        ],
      },
    },
  });
}

async function cleanupShifts(tenantId: string) {
  // "Смены" = весь модуль Рабочее время: сами смены, авансы/премии (и
  // привязанные к конкретной смене, и разовые без shiftId), переносы баланса.
  // advance_settlement (аудит 2026-07-25) — зонные записи, которыми
  // chargeSelfServiceAdvanceToZones (lib/zone-balance.ts) сразу разносит
  // самообслуживаемый аванс/премию по зонам; без этой строки очистка ТОЛЬКО
  // "Смен" (без "Инкассаций") удаляла бы advance/bonus_payout, но оставляла
  // бы зонные остатки навсегда заниженными на уже списанную сумму —
  // orphaned-запись без источника. Тот же тип используется и
  // settleOutstandingCollectionAdvance (погашение "Аванса инкассации") —
  // здесь удаляются ОБА происхождения разом, это осознанно: без авансов/
  // премий смен и без истории инкассаций (см. cleanupCollections) сама эта
  // зонная корректировка теряет смысл в любом случае.
  await prisma.moneyOperation.deleteMany({
    where: { tenantId, type: { in: ["advance", "bonus_payout", "advance_settlement"] } },
  });
  await prisma.operatorBalanceCarryover.deleteMany({ where: { tenantId } });
  await prisma.shift.deleteMany({ where: { tenantId } });
}

async function cleanupChangeFund(tenantId: string) {
  await prisma.moneyOperation.deleteMany({ where: { tenantId, type: "change_fund" } });
}

// "Товары" — не было категории вовсе (аудит 2026-07-25, финальный проход:
// ни один из типов goods_revenue*/goods_change_fund, ни сама история продаж/
// довозов/ревизий/сверок не были покрыты НИ ОДНОЙ категорией, включая
// "Очистить всё"). Каталог (Goods/GoodsCategory) и текущие остатки
// (GoodsStock) НЕ трогаем — тот же принцип, что у "Счётчиков"/"Смен": здесь
// стирается история операций, не настройка/текущее состояние.
async function cleanupGoods(tenantId: string) {
  await prisma.moneyOperation.deleteMany({
    where: { tenantId, type: { in: ["goods_revenue", "goods_revenue_cashless", "goods_revenue_abonement", "goods_change_fund"] } },
  });
  await prisma.goodsSale.deleteMany({ where: { tenantId } });
  await prisma.goodsRestock.deleteMany({ where: { goods: { tenantId } } });
  await prisma.goodsRevision.deleteMany({ where: { tenantId } });
  await prisma.goodsReconciliation.deleteMany({ where: { tenantId } });
}

// "Клиенты" — та же находка, что у "Товаров": ни одной категории. Кошельки
// удаляются целиком (не только их топ-апы) — тот же смысл, что у остальных
// категорий "очистки перед реальным стартом": тестовые клиенты с тестовыми
// балансами, а не только денежный след. AbonementTransaction уходит
// каскадом (onDelete: Cascade), ссылки на кошелёк у GoodsSale/TicketOrder/
// Launch — onDelete: SetNull, ничего не блокирует и не осиротевает.
async function cleanupClients(tenantId: string) {
  await prisma.moneyOperation.deleteMany({
    where: { tenantId, type: { in: ["abonement_topup", "abonement_topup_cashless"] } },
  });
  await prisma.abonementWallet.deleteMany({ where: { tenantId } });
}

const CLEANUP_RUNNERS: Record<Exclude<CleanupCategory, "all">, (tenantId: string) => Promise<void>> = {
  results: cleanupResults,
  collections: cleanupCollections,
  shifts: cleanupShifts,
  change_fund: cleanupChangeFund,
  goods: cleanupGoods,
  clients: cleanupClients,
};

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { name: true } });
  return NextResponse.json({ tenantName: tenant?.name ?? "" });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { category, password, confirmText } = await request.json();

  if (!isCleanupCategory(category)) {
    return NextResponse.json({ error: "Некорректная категория очистки" }, { status: 400 });
  }
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Введите пароль" }, { status: 400 });
  }

  const passwordOk = await verifyPassword(password, owner.user.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { name: true } });
  if (!tenant) {
    return NextResponse.json({ error: "Тенант не найден" }, { status: 404 });
  }
  if (typeof confirmText !== "string" || confirmText.trim() !== tenant.name) {
    return NextResponse.json({ error: "Название компании введено неверно" }, { status: 400 });
  }

  if (category === "all") {
    await cleanupResults(owner.tenantId);
    await cleanupCollections(owner.tenantId);
    await cleanupShifts(owner.tenantId);
    await cleanupChangeFund(owner.tenantId);
    await cleanupGoods(owner.tenantId);
    await cleanupClients(owner.tenantId);
  } else {
    await CLEANUP_RUNNERS[category](owner.tenantId);
  }

  return NextResponse.json({ ok: true });
}
