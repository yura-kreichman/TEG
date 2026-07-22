import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { normalizePhone } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { getClientBalanceDeepLink } from "@/lib/telegram-bot";

async function findOwnedWallet(tenantId: string, id: string) {
  const wallet = await prisma.abonementWallet.findUnique({ where: { id } });
  if (!wallet || wallet.tenantId !== tenantId) return null;
  return wallet;
}

// Детали кошелька + история операций (запрос пользователя 2026-07-17: "у
// владельца нет ни истории купленных абонементов, ни возможности... удалить,
// ни редактировать") — полный CRUD-компаньон к /api/abonement-wallets/list.
export async function GET(_request: Request, ctx: RouteContext<"/api/abonement-wallets/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const wallet = await findOwnedWallet(owner.tenantId, id);
  if (!wallet) {
    return NextResponse.json({ error: "Абонент не найден" }, { status: 404 });
  }

  const history = await prisma.abonementTransaction.findMany({
    where: { walletId: id },
    orderBy: { occurredAt: "desc" },
    take: 100,
    include: {
      abonement: { select: { name: true, price: true, creditAmount: true } },
      point: { select: { name: true } },
      operator: { select: { name: true } },
      user: { select: { id: true } },
    },
  });

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true } });
  const telegramBalanceLink = tenant?.slug ? await getClientBalanceDeepLink(tenant.slug) : null;

  return NextResponse.json({
    id: wallet.id,
    phone: wallet.phone,
    name: wallet.name,
    balance: Number(wallet.balance),
    createdAt: wallet.createdAt,
    telegramBalanceLink,
    history: history.map((h) => ({
      id: h.id,
      type: h.type,
      amount: Number(h.amount),
      occurredAt: h.occurredAt,
      planName: h.abonement?.name ?? null,
      paymentMethod: h.paymentMethod,
      pointName: h.point?.name ?? null,
      // Email владельца не отдаём наружу (реальный баг, найден пользователем
      // 2026-07-20: "должно быть просто Владелец") — отдельный флаг вместо
      // строки-емейла, клиент сам подставляет переведённую роль (t.common.
      // ownerLabel), как и везде в квитанциях/этом же экране.
      performedBy: h.operator?.name ?? null,
      performedByOwner: !!h.user,
    })),
  });
}

// Правка имени/телефона владельцем — баланс тут НЕ редактируется напрямую
// (нет логики без транзакции, см. src/lib/abonement.ts) — для этого есть
// произвольная сумма в потоке "Продать"/"Пополнить".
export async function PATCH(request: Request, ctx: RouteContext<"/api/abonement-wallets/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const wallet = await findOwnedWallet(owner.tenantId, id);
  if (!wallet) {
    return NextResponse.json({ error: "Абонент не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const rawPhone: string | undefined = typeof body.phone === "string" ? body.phone : undefined;
  const name: string | null | undefined =
    body.name === undefined ? undefined : typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  let phone: string | undefined;
  if (rawPhone !== undefined) {
    phone = normalizePhone(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: "Введите номер телефона" }, { status: 400 });
    }
    if (phone !== wallet.phone) {
      const clash = await prisma.abonementWallet.findUnique({
        where: { tenantId_phone: { tenantId: owner.tenantId, phone } },
      });
      if (clash) {
        return NextResponse.json({ error: "Абонент с этим номером уже существует" }, { status: 400 });
      }
    }
  }

  await prisma.abonementWallet.update({
    where: { id },
    data: { ...(phone !== undefined ? { phone } : {}), ...(name !== undefined ? { name } : {}) },
  });
  return NextResponse.json({ ok: true });
}

// Удаление кошелька владельцем — история операций уходит каскадом
// (AbonementTransaction.walletId onDelete: Cascade), пуски, оплаченные этим
// кошельком, остаются (Launch.abonementWalletId onDelete: SetNull).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/abonement-wallets/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "clientsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const wallet = await findOwnedWallet(owner.tenantId, id);
  if (!wallet) {
    return NextResponse.json({ error: "Абонент не найден" }, { status: 404 });
  }

  await prisma.abonementWallet.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
