import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

const SUBSCRIPTION_STATUSES = ["trialing", "active", "paused", "expired"] as const;
type SubscriptionStatusValue = (typeof SUBSCRIPTION_STATUSES)[number];

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
      moduleFlags: true,
      _count: { select: { operators: true } },
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const [pointsCount, assetsCount, zonesCount, history, owner] = await Promise.all([
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
  ]);

  return NextResponse.json({
    id: tenant.id,
    name: tenant.name,
    subscriptionStatus: tenant.subscriptionStatus,
    subscriptionExpiresAt: tenant.subscriptionExpiresAt,
    trialEndsAt: tenant.trialEndsAt,
    contactPhone: tenant.contactPhone,
    adminNote: tenant.adminNote,
    ownerEmail: owner?.email ?? null,
    createdAt: tenant.createdAt,
    package: tenant.package,
    moduleFlags: tenant.moduleFlags.map((m) => ({ moduleKey: m.moduleKey, enabled: m.enabled })),
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

  const { subscriptionStatus, packageId, subscriptionExpiresAt, trialEndsAt, contactPhone, adminNote, comment } =
    await request.json();
  const data: {
    subscriptionStatus?: SubscriptionStatusValue;
    packageId?: string;
    subscriptionExpiresAt?: Date | null;
    trialEndsAt?: Date | null;
    contactPhone?: string | null;
    adminNote?: string | null;
  } = {};
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
  if (trialEndsAt !== undefined) {
    const parsed = parseDateField(trialEndsAt);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Некорректная дата окончания триала" }, { status: 400 });
    }
    data.trialEndsAt = parsed.date;
    before.trialEndsAt = tenant.trialEndsAt;
    after.trialEndsAt = parsed.date;
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
