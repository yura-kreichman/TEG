import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";

export async function GET(_request: Request, ctx: RouteContext<"/api/points/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  return NextResponse.json({
    id: point.id,
    name: point.name,
    address: point.address,
    iconKey: point.iconKey,
    city: point.city,
    latitude: point.latitude,
    longitude: point.longitude,
    hoursNote: point.hoursNote,
    mapsUrl: point.mapsUrl,
    active: point.active,
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/points/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  const { name, address, iconKey, city, latitude, longitude, hoursNote, mapsUrl, active } = await request.json();
  const data: {
    name?: string;
    address?: string | null;
    iconKey?: string | null;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    hoursNote?: string | null;
    mapsUrl?: string | null;
    active?: boolean;
  } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название точки обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (address !== undefined) {
    data.address = typeof address === "string" && address.trim() ? address.trim() : null;
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }
  // Поля docs/spec/08-landing.md, "Где нас найти" — редактируются в
  // настройках Точки (не в разделе Лендинг), см. Шаг 5.
  if (city !== undefined) {
    data.city = typeof city === "string" && city.trim() ? city.trim() : null;
  }
  if (latitude !== undefined) {
    if (latitude !== null && (typeof latitude !== "number" || latitude < -90 || latitude > 90)) {
      return NextResponse.json({ error: "Некорректная широта" }, { status: 400 });
    }
    data.latitude = latitude;
  }
  if (longitude !== undefined) {
    if (longitude !== null && (typeof longitude !== "number" || longitude < -180 || longitude > 180)) {
      return NextResponse.json({ error: "Некорректная долгота" }, { status: 400 });
    }
    data.longitude = longitude;
  }
  if (hoursNote !== undefined) {
    data.hoursNote = typeof hoursNote === "string" && hoursNote.trim() ? hoursNote.trim() : null;
  }
  if (mapsUrl !== undefined) {
    if (mapsUrl !== null && mapsUrl !== "" && typeof mapsUrl === "string") {
      if (!/^https?:\/\//i.test(mapsUrl.trim())) {
        return NextResponse.json({ error: "Ссылка должна начинаться с http:// или https://" }, { status: 400 });
      }
    }
    data.mapsUrl = typeof mapsUrl === "string" && mapsUrl.trim() ? mapsUrl.trim() : null;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение active" }, { status: 400 });
    }
    // Та же причина, что и у деактивации отдельной зоны (аудит 2026-07-24,
    // /api/zones/[id]/route.ts) — только шире: requireOperator() проверяет
    // device.point.active ПЕРВЫМ делом (lib/require-operator.ts), поэтому
    // деактивация точки мгновенно блокирует ЛЮБОЕ действие оператора на её
    // устройствах, включая стоп уже открытых пусков — не только в
    // "проблемной" зоне, а на всей точке разом.
    if (active === false) {
      const openLaunches = await prisma.launch.count({
        where: { zone: { pointId: id, accountingMode: "stays" }, isOpen: true },
      });
      if (openLaunches > 0) {
        return NextResponse.json(
          { error: `Заверши ${openLaunches} активных пусков на точке, прежде чем её деактивировать` },
          { status: 409 }
        );
      }
    }
    data.active = active;
  }

  await prisma.point.update({ where: { id }, data });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/points/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const point = await prisma.point.findUnique({ where: { id } });
  if (!point || point.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
  }

  // A Point referenced by historical records (results submissions / money
  // operations on its zones) can't be hard-deleted without silently losing
  // that history via cascade — same guard as Operator deletion.
  const [submissionCount, moneyOpCount] = await Promise.all([
    prisma.resultsSubmission.count({ where: { pointId: id } }),
    prisma.moneyOperation.count({ where: { zone: { pointId: id } } }),
  ]);
  if (submissionCount > 0 || moneyOpCount > 0) {
    return NextResponse.json(
      { error: "У этой точки есть история сдач итогов/операций — её нельзя удалить." },
      { status: 409 }
    );
  }

  await prisma.point.delete({ where: { id } });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
