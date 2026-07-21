import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { verifyPassword } from "@/lib/auth";

const SUBSCRIPTION_STATUSES = ["active", "paused", "suspended", "expired"] as const;

const LIMIT_OVERRIDE_KEYS = ["maxPoints", "maxZones", "maxAssets", "maxOperators"] as const;
type LimitOverrideKey = (typeof LIMIT_OVERRIDE_KEYS)[number];
type LimitOverrides = Partial<Record<LimitOverrideKey, number>>;

function parseDateField(value: unknown): { ok: true; date: Date | null } | { ok: false } {
  if (value === null) return { ok: true, date: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, date };
}

export async function GET(_request: Request, ctx: RouteContext<"/api/admin/tenants/[id]">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      package: true,
      _count: { select: { operators: true } },
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const [pointsCount, assetsCount, zonesCount, history, owner, billingHistory] = await Promise.all([
    prisma.point.count({ where: { tenantId: id } }),
    prisma.asset.count({ where: { zone: { point: { tenantId: id } } } }),
    prisma.zone.count({ where: { point: { tenantId: id } } }),
    prisma.correctionLog.findMany({
      where: { entityType: "Tenant", entityId: id },
      orderBy: { correctedAt: "desc" },
      take: 20,
      include: { correctedBy: { select: { email: true } } },
    }),
    prisma.user.findFirst({ where: { tenantId: id, role: "owner" }, select: { email: true }, orderBy: { createdAt: "asc" } }),
    // История событий биллинга (docs/spec/06-super-admin.md, п.4) — только
    // read-only лог, без ресинка/действий над записями.
    prisma.webhookEvent.findMany({
      where: { tenantId: id },
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({
    id: tenant.id,
    name: tenant.name,
    subscriptionStatus: tenant.subscriptionStatus,
    subscriptionExpiresAt: tenant.subscriptionExpiresAt,
    currentPeriodEnd: tenant.currentPeriodEnd,
    contactPhone: tenant.contactPhone,
    adminNote: tenant.adminNote,
    ownerEmail: owner?.email ?? null,
    createdAt: tenant.createdAt,
    package: tenant.package,
    fluentcartCustomerId: tenant.fluentcartCustomerId,
    unlimited: tenant.unlimited,
    limitOverrides: (tenant.limitOverrides as LimitOverrides | null) ?? {},
    usage: {
      points: pointsCount,
      zones: zonesCount,
      assets: assetsCount,
      operators: tenant._count.operators,
    },
    history: history.map((h) => ({
      id: h.id,
      correctedAt: h.correctedAt,
      correctedByEmail: h.correctedBy?.email ?? null,
      before: h.beforeJson,
      after: h.afterJson,
      comment: h.comment,
    })),
    billingHistory: billingHistory.map((w) => ({
      id: w.id,
      eventType: w.eventType,
      status: w.status,
      error: w.error,
      receivedAt: w.receivedAt,
    })),
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/tenants/[id]">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const {
    subscriptionStatus,
    packageId,
    subscriptionExpiresAt,
    currentPeriodEnd,
    contactPhone,
    adminNote,
    limitOverrides,
    unlimited,
    fluentcartCustomerId,
    comment,
  } = await request.json();
  const data: Prisma.TenantUncheckedUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (subscriptionStatus !== undefined) {
    if (!SUBSCRIPTION_STATUSES.includes(subscriptionStatus)) {
      return NextResponse.json({ error: "Некорректный статус подписки" }, { status: 400 });
    }
    data.subscriptionStatus = subscriptionStatus;
    before.subscriptionStatus = tenant.subscriptionStatus;
    after.subscriptionStatus = subscriptionStatus;
  }
  if (packageId !== undefined) {
    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) {
      return NextResponse.json({ error: "Пакет не найден" }, { status: 400 });
    }
    data.packageId = packageId;
    before.packageId = tenant.packageId;
    after.packageId = packageId;
  }
  if (subscriptionExpiresAt !== undefined) {
    const parsed = parseDateField(subscriptionExpiresAt);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Некорректная дата окончания подписки" }, { status: 400 });
    }
    data.subscriptionExpiresAt = parsed.date;
    before.subscriptionExpiresAt = tenant.subscriptionExpiresAt;
    after.subscriptionExpiresAt = parsed.date;
  }
  // Информационная дата "действует до" (docs/fluentcart-webhook-schema.md
  // §3) — обычно ставится вебхуком из next_billing_date, но админу иногда
  // нужно поправить руками (например, после ручной коррекции статуса).
  if (currentPeriodEnd !== undefined) {
    const value = currentPeriodEnd === null ? null : new Date(currentPeriodEnd as string);
    if (value !== null && Number.isNaN(value.getTime())) {
      return NextResponse.json({ error: "Некорректная дата окончания периода" }, { status: 400 });
    }
    data.currentPeriodEnd = value;
    before.currentPeriodEnd = tenant.currentPeriodEnd;
    after.currentPeriodEnd = value;
  }
  if (contactPhone !== undefined) {
    if (contactPhone !== null && typeof contactPhone !== "string") {
      return NextResponse.json({ error: "Некорректный телефон" }, { status: 400 });
    }
    const value = typeof contactPhone === "string" && contactPhone.trim() ? contactPhone.trim() : null;
    data.contactPhone = value;
    before.contactPhone = tenant.contactPhone;
    after.contactPhone = value;
  }
  if (adminNote !== undefined) {
    if (adminNote !== null && typeof adminNote !== "string") {
      return NextResponse.json({ error: "Некорректная заметка" }, { status: 400 });
    }
    const value = typeof adminNote === "string" && adminNote.trim() ? adminNote.trim() : null;
    data.adminNote = value;
    before.adminNote = tenant.adminNote;
    after.adminNote = value;
  }

  // Ручная привязка/отвязка к FluentCart (доп. инструкция "связывание
  // тенанта с FluentCart", 2026-07-12) — на случай, если тенант оплатил до
  // того, как вебхук успел связать его по email, или email не совпал.
  if (fluentcartCustomerId !== undefined) {
    if (fluentcartCustomerId !== null && typeof fluentcartCustomerId !== "string") {
      return NextResponse.json({ error: "Некорректный fluentcartCustomerId" }, { status: 400 });
    }
    const value = typeof fluentcartCustomerId === "string" && fluentcartCustomerId.trim() ? fluentcartCustomerId.trim() : null;
    if (value) {
      const conflict = await prisma.tenant.findUnique({ where: { fluentcartCustomerId: value } });
      if (conflict && conflict.id !== id) {
        return NextResponse.json({ error: "Этот customer_id уже привязан к другому тенанту" }, { status: 409 });
      }
    }
    data.fluentcartCustomerId = value;
    before.fluentcartCustomerId = tenant.fluentcartCustomerId;
    after.fluentcartCustomerId = value;
  }

  if (unlimited !== undefined) {
    if (typeof unlimited !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение unlimited" }, { status: 400 });
    }
    data.unlimited = unlimited;
    before.unlimited = tenant.unlimited;
    after.unlimited = unlimited;
    // "Безлимит = безлимит на всё" (реальный баг, найден пользователем
    // 2026-07-20: включил Безлимит на проде, срок подписки не изменился) —
    // безлимит снимает не только 4 числовых лимита (Точки/Зоны/Активы/
    // Сотрудники), но и срок действия подписки, иначе тенант с бессрочным
    // безлимитом всё равно упирался бы в дату и планировщик переводил его в
    // "Истекла". Не трогаем, если сам запрос ЯВНО прислал свою
    // subscriptionExpiresAt в этом же PATCH — тот случай уже обработан выше.
    if (unlimited && subscriptionExpiresAt === undefined) {
      data.subscriptionExpiresAt = null;
      before.subscriptionExpiresAt = tenant.subscriptionExpiresAt;
      after.subscriptionExpiresAt = null;
    }
  }
  if (limitOverrides !== undefined) {
    if (limitOverrides === null) {
      data.limitOverrides = Prisma.JsonNull;
      before.limitOverrides = tenant.limitOverrides;
      after.limitOverrides = null;
    } else {
      if (typeof limitOverrides !== "object") {
        return NextResponse.json({ error: "Некорректные оверрайды лимитов" }, { status: 400 });
      }
      const parsed: LimitOverrides = {};
      for (const key of LIMIT_OVERRIDE_KEYS) {
        const value = limitOverrides[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          return NextResponse.json({ error: `Некорректное значение лимита "${key}"` }, { status: 400 });
        }
        parsed[key] = value;
      }
      data.limitOverrides = JSON.parse(JSON.stringify(parsed));
      before.limitOverrides = tenant.limitOverrides;
      after.limitOverrides = parsed;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true });
  }

  await prisma.$transaction([
    prisma.tenant.update({ where: { id }, data }),
    prisma.correctionLog.create({
      data: {
        entityType: "Tenant",
        entityId: id,
        correctedByUserId: admin.user.id,
        beforeJson: JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify(after)),
        comment: typeof comment === "string" && comment.trim() ? comment.trim() : null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

// Полное удаление Владельца (решение пользователя 2026-07-12) — необратимо,
// каскадом уносит весь тенант (все relation'ы на Tenant.tenantId объявлены
// с onDelete: Cascade, см. schema.prisma). Заблокировано при активной
// FluentCart-подписке — иначе с клиента продолжат списывать деньги за
// аккаунт, которого уже нет в RentOS, а отменить подписку можно только
// вручную в самом FluentCart (в коде нет API для отмены). CorrectionLog не
// каскадируется на Tenant (нет прямого FK, только entityId-строка) — запись
// об удалении переживает сам тенант, это единственный оставшийся audit-след.
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/tenants/[id]">) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tenant = await prisma.tenant.findUnique({ where: { id }, include: { package: true } });
  if (!tenant) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const { password, confirmText } = await request.json();

  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Введите пароль" }, { status: 400 });
  }
  const passwordOk = await verifyPassword(password, admin.user.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  if (typeof confirmText !== "string" || confirmText.trim() !== tenant.name) {
    return NextResponse.json({ error: "Название компании введено неверно" }, { status: 400 });
  }
  // Free-пакет (priceMonthly = 0) не блокируем даже при болтающемся
  // fluentcartCustomerId/active — реальных денег там нет, блокировка нужна
  // только против удаления тенанта, за которого продолжат списывать оплату
  // (решение пользователя 2026-07-12: "При подписке Free удалять").
  const isPaidActive = Number(tenant.package.priceMonthly) > 0 && tenant.fluentcartCustomerId && tenant.subscriptionStatus === "active";
  if (isPaidActive) {
    return NextResponse.json(
      { error: "У тенанта активная платная подписка FluentCart — сначала отмените её в FluentCart, затем повторите удаление" },
      { status: 409 }
    );
  }

  await prisma.correctionLog.create({
    data: {
      entityType: "Tenant",
      entityId: id,
      correctedByUserId: admin.user.id,
      beforeJson: JSON.parse(JSON.stringify({ name: tenant.name, subscriptionStatus: tenant.subscriptionStatus })),
      afterJson: { deleted: true },
      comment: "Полное удаление владельца из админ-модуля",
    },
  });
  await prisma.tenant.delete({ where: { id } });

  // Загруженные файлы (public/uploads/<tenantId>/, см. src/lib/uploads.ts)
  // лежат на диске, а не в БД — каскад Prisma их не трогает. Best-effort:
  // тенант уже удалён, оставлять пустую/сиротскую папку хуже, чем не удалить
  // её при редкой ошибке файловой системы.
  await rm(path.join(process.cwd(), "public", "uploads", id), { recursive: true, force: true }).catch(() => {});

  return NextResponse.json({ ok: true });
}
