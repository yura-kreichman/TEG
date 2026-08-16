import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { normalizePhone, phoneMatchKey, hasTelegramLink, describeAbonementTransactionSource } from "@/lib/abonement";
import { isModuleEnabled } from "@/lib/tenant-modules";
import { getClientBalanceDeepLink } from "@/lib/telegram-bot";
import { periodBoundsUtc } from "@/lib/business-day";

async function findOwnedWallet(tenantId: string, id: string) {
  const wallet = await prisma.abonementWallet.findUnique({ where: { id } });
  if (!wallet || wallet.tenantId !== tenantId) return null;
  return wallet;
}

// Детали кошелька + история операций (запрос пользователя 2026-07-17: "у
// владельца нет ни истории купленных абонементов, ни возможности... удалить,
// ни редактировать") — полный CRUD-компаньон к /api/abonement-wallets/list.
export async function GET(request: Request, ctx: RouteContext<"/api/abonement-wallets/[id]">) {
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

  // Переключатель месяцев в истории (запрос пользователя 2026-07-24:
  // "слишком большой список будет") — тот же приём from/to, что у
  // /api/operator/work-time/shifts. Без параметров — старое поведение
  // (последние 100 когда-либо), для обратной совместимости.
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  // Границы месяца — в календаре тенанта, не в сырой UTC-полночи сервера
  // (см. periodBoundsUtc, тот же фикс 2026-08-02, что и у Рабочего времени):
  // операция клиента, проведённая ночью 1-го числа, иначе показывалась бы в
  // предыдущем месяце его выписки.
  const tenantForTz = await prisma.tenant.findUnique({
    where: { id: owner.tenantId },
    select: { timezone: true, businessDayBoundary: true },
  });
  const period = fromParam && toParam ? periodBoundsUtc(fromParam, toParam, tenantForTz?.timezone ?? "UTC", tenantForTz?.businessDayBoundary ?? "00:00") : undefined;
  const occurredAt = period ? { gte: period.from, lt: period.to } : undefined;

  const history = await prisma.abonementTransaction.findMany({
    where: { walletId: id, ...(occurredAt ? { occurredAt } : {}) },
    orderBy: { occurredAt: "desc" },
    take: occurredAt ? 500 : 100,
    include: {
      abonement: { select: { name: true, price: true, creditAmount: true } },
      point: { select: { name: true } },
      operator: { select: { name: true, colorTag: true } },
      user: { select: { id: true } },
      launch: { select: { zone: { select: { name: true } } } },
      goodsSale: { select: { goods: { select: { name: true } } } },
      ticketOrder: { select: { zone: { select: { name: true } } } },
      tariff: { select: { zone: { select: { name: true } } } },
    },
  });

  const tenant = await prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true } });
  const telegramBalanceLink = tenant?.slug ? await getClientBalanceDeepLink(tenant.slug) : null;
  const hasTelegram = await hasTelegramLink(owner.tenantId, wallet.phone);
  // Название точки в истории — только если точек больше одной (запрос
  // пользователя 2026-07-25: "нет смысла... если у Владельца одна точка"),
  // тот же приём showPointName, что и в /api/reports/money/expenses.
  const pointCount = await prisma.point.count({ where: { tenantId: owner.tenantId } });

  return NextResponse.json({
    id: wallet.id,
    phone: wallet.phone,
    name: wallet.name,
    balance: Number(wallet.balance),
    createdAt: wallet.createdAt,
    telegramBalanceLink,
    hasTelegram,
    showPointName: pointCount > 1,
    history: history.map((h) => ({
      id: h.id,
      type: h.type,
      amount: Number(h.amount),
      occurredAt: h.occurredAt,
      planName: h.abonement?.name ?? null,
      description: describeAbonementTransactionSource(h),
      quantity: h.quantity,
      paymentMethod: h.paymentMethod,
      pointName: h.point?.name ?? null,
      // Email владельца не отдаём наружу (реальный баг, найден пользователем
      // 2026-07-20: "должно быть просто Владелец") — отдельный флаг вместо
      // строки-емейла, клиент сам подставляет переведённую роль (t.common.
      // ownerLabel), как и везде в квитанциях/этом же экране.
      performedBy: h.operator?.name ?? null,
      performedByColorTag: h.operator?.colorTag ?? null,
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
    // phoneKey пересчитывается вместе с номером — иначе кошелёк остался бы
    // findable по СТАРОМУ хвосту (и, что хуже, не находился бы по новому).
    data: {
      ...(phone !== undefined ? { phone, phoneKey: phoneMatchKey(phone) } : {}),
      ...(name !== undefined ? { name } : {}),
    },
  });

  // Смена номера — старая привязка Telegram-чата к СТАРОМУ номеру больше не
  // должна резолвиться в этот кошелёк (аудит 2026-07-24, реальная утечка:
  // ClientTelegramLink хранит только (chatId, phone), без FK на кошелёк —
  // если номер позже достанется ДРУГОМУ клиенту, старый чат молча "унаследует"
  // чужой баланс/историю и продолжит получать проактивные push об изменении
  // баланса чужого кошелька). Чат не переносится автоматически на новый номер —
  // клиент должен заново подтвердить контакт (request_contact), это осознанно:
  // сам факт смены номера не доказывает, что это тот же человек.
  if (phone !== undefined && phone !== wallet.phone) {
    await prisma.clientTelegramLink.deleteMany({ where: { tenantId: owner.tenantId, phone: wallet.phone } });
  }
  return NextResponse.json({ ok: true });
}

// Удаление кошелька владельцем — история операций уходит каскадом
// (AbonementTransaction.walletId onDelete: Cascade), пуски, оплаченные этим
// кошельком, остаются (Launch.abonementWalletId onDelete: SetNull).
//
// Ненулевой остаток при удалении (аудит 2026-07-25, финальный проход):
// раньше баланс молча пропадал вместе с кошельком — ни следа в CorrectionLog,
// подтверждение на клиенте не упоминало сумму вовсе. Полностью блокировать
// удаление до обнуления баланса — тупик (в проекте пока нет отдельной формы
// "списать остаток без покупки", клиент может быть просто закрыт навсегда с
// небольшим неиспользуемым остатком) — поэтому удаление разрешено, но при
// ненулевом балансе пишем CorrectionLog (entityId — свободная ссылка, не FK,
// переживает каскадное удаление кошелька) с точной прощённой суммой, чтобы
// в истории остался след, а не полная тишина.
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

  const forfeitedBalance = Number(wallet.balance);
  await prisma.$transaction(async (tx) => {
    if (forfeitedBalance !== 0) {
      await tx.correctionLog.create({
        data: {
          entityType: "AbonementWallet",
          entityId: id,
          correctedByUserId: owner.user.id,
          beforeJson: { phone: wallet.phone, name: wallet.name, balance: forfeitedBalance },
          afterJson: { deleted: true, forfeitedBalance },
          comment: "Кошелёк удалён с ненулевым остатком — остаток безвозвратно списан",
        },
      });
    }
    await tx.abonementWallet.delete({ where: { id } });
  });
  return NextResponse.json({ ok: true, forfeitedBalance });
}
