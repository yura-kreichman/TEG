import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/require-super-admin";

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
    contactPhone: tenant.contactPhone,
    adminNote: tenant.adminNote,
    ownerEmail: owner?.email ?? null,
    createdAt: tenant.createdAt,
    package: tenant.package,
    fluentcartCustomerId: tenant.fluentcartCustomerId,
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
      correctedByEmail: h.correctedBy.email,
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
    contactPhone,
    adminNote,
    limitOverrides,
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
