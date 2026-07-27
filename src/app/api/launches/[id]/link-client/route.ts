import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { findWalletByPhone, createWalletEmpty, normalizePhone } from "@/lib/abonement";

async function checkAccess(id: string, opCtx: NonNullable<Awaited<ReturnType<typeof requireOperator>>>) {
  const { operator, point } = opCtx;
  const launch = await prisma.launch.findUnique({
    where: { id },
    select: { zoneId: true, zone: { select: { pointId: true, accountingMode: true } } },
  });
  if (!launch || launch.zone.pointId !== point.id) return { error: "Пуск не найден", status: 404 } as const;
  if (launch.zone.accountingMode !== "stays") return { error: "Доступно только для «Прибываний»", status: 400 } as const;
  if (!operator.allZonesAccess) {
    const hasAccess = await prisma.zone.findFirst({
      where: { id: launch.zoneId, operatorsWithAccess: { some: { id: operator.id } } },
      select: { id: true },
    });
    if (!hasAccess) return { error: "Нет доступа к этой зоне", status: 403 } as const;
  }
  return null;
}

/**
 * Поиск клиента по телефону для привязки "чей это ребёнок" (запрос
 * пользователя 2026-07-27, после ревью: "образ привязки — Найти или Новый",
 * не молчаливое find-or-create в один шаг) — тот же паттерн, что
 * AbonementPaymentSheet: сначала ищем, оператор ВИДИТ найденного клиента
 * или явный "не найден", и только тогда решает — привязать найденного или
 * завести нового.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/launches/[id]/link-client">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  if (!(await isModuleEnabled(opCtx.point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const access = await checkAccess(id, opCtx);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  const phone = new URL(request.url).searchParams.get("phone") ?? "";
  if (!normalizePhone(phone)) {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }
  const wallet = await findWalletByPhone(opCtx.point.tenantId, phone);
  return NextResponse.json({
    client: wallet ? { id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) } : null,
  });
}

/**
 * Привязка "чей это ребёнок" к пуску "Прибываний" — либо уже найденного
 * кошелька (body.walletId, после GET выше), либо заведение нового по
 * телефону (body.phone, кнопка "Новый" — только если поиск ничего не
 * нашёл). Никак не влияет на Launch.paymentMethod/abonementWalletId.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/launches/[id]/link-client">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { point } = opCtx;
  const { id } = await ctx.params;

  if (!(await isModuleEnabled(point.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }
  const access = await checkAccess(id, opCtx);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { walletId, phone, name } = await request.json().catch(() => ({}));

  let wallet;
  if (typeof walletId === "string" && walletId) {
    wallet = await prisma.abonementWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.tenantId !== point.tenantId) {
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    }
  } else if (typeof phone === "string" && normalizePhone(phone)) {
    // "Новый" — тот же стандартный экран "Новый клиент", что и везде в
    // проекте (запрос пользователя 2026-07-27: "нужен стандартный интерфейс
    // добавления нового клиента"), имя опционально.
    const trimmedName = typeof name === "string" ? name.trim() : "";
    wallet = await createWalletEmpty(phone, trimmedName || null, point.tenantId);
  } else {
    return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
  }

  await prisma.launch.update({ where: { id }, data: { linkedClientWalletId: wallet.id } });

  return NextResponse.json({ id: wallet.id, phone: wallet.phone, name: wallet.name, balance: Number(wallet.balance) });
}

// Убрать привязку (запрос пользователя 2026-07-27) — не удаляет клиента,
// только снимает метку с этого пуска.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/launches/[id]/link-client">) {
  const opCtx = await requireOperator();
  if (!opCtx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const access = await checkAccess(id, opCtx);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  await prisma.launch.update({ where: { id }, data: { linkedClientWalletId: null } });
  return NextResponse.json({ ok: true });
}
