import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { verifyPassword } from "@/lib/auth";

// Категории очистки (докс: фидбек пользователя 2026-07-09). MoneyOperation
// не имеет реальных FK на ResultsSubmission/Shift (resultsSubmissionId/shiftId —
// свободные строки, см. схему) — каскада нет, поэтому связанные операции
// журнала денег удаляются явно вместе с "родителем", иначе останутся висящие
// записи выручки/расходов/авансов без источника.
export const CLEANUP_CATEGORIES = ["results", "collections", "shifts", "change_fund", "all"] as const;
export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];

function isCleanupCategory(value: unknown): value is CleanupCategory {
  return typeof value === "string" && (CLEANUP_CATEGORIES as readonly string[]).includes(value);
}

async function cleanupResults(tenantId: string) {
  await prisma.moneyOperation.deleteMany({ where: { tenantId, resultsSubmissionId: { not: null } } });
  await prisma.resultsSubmission.deleteMany({ where: { tenantId } });
}

async function cleanupCollections(tenantId: string) {
  await prisma.moneyOperation.deleteMany({ where: { tenantId, type: "collection" } });
}

async function cleanupShifts(tenantId: string) {
  // "Смены" = весь модуль Рабочее время: сами смены, авансы/премии (и
  // привязанные к конкретной смене, и разовые без shiftId), переносы баланса.
  await prisma.moneyOperation.deleteMany({ where: { tenantId, type: { in: ["advance", "bonus_payout"] } } });
  await prisma.operatorBalanceCarryover.deleteMany({ where: { tenantId } });
  await prisma.shift.deleteMany({ where: { tenantId } });
}

async function cleanupChangeFund(tenantId: string) {
  await prisma.moneyOperation.deleteMany({ where: { tenantId, type: "change_fund" } });
}

const CLEANUP_RUNNERS: Record<Exclude<CleanupCategory, "all">, (tenantId: string) => Promise<void>> = {
  results: cleanupResults,
  collections: cleanupCollections,
  shifts: cleanupShifts,
  change_fund: cleanupChangeFund,
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
  } else {
    await CLEANUP_RUNNERS[category](owner.tenantId);
  }

  return NextResponse.json({ ok: true });
}
