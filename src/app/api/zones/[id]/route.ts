import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { isZoneAccountingMode } from "@/lib/results-calc";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { getInitialReadingsMap } from "@/lib/asset-initial-readings";

export async function GET(_request: Request, ctx: RouteContext<"/api/zones/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, id);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const [tariffs, assets] = await Promise.all([
    prisma.tariff.findMany({
      where: { zoneId: id, deletedAt: null },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    }),
    prisma.asset.findMany({ where: { zoneId: id }, orderBy: { sortOrder: "asc" } }),
  ]);

  const submissionCount = await prisma.zoneSubmission.count({ where: { zoneId: id } });

  // Последние показания под названием актива в списке (запрос пользователя
  // 2026-07-14: вместо "фото загружено"/"без фото" — реальные цифры
  // счётчика). "Начальное показание" в кебаб-меню остаётся доступным даже
  // после первых сдач (запрос пользователя того же дня, реальный кейс:
  // опечатка в перенесённом калибровочном значении обнаружилась только
  // после первой сдачи, а расчёт выручки первой сдачи цепочки берёт
  // "предыдущее" именно из калибровки и пересчитывается заново при каждом
  // показе — исправление здесь заднем числом реально чинит эту сдачу).
  const allReadings =
    zone.accountingMode === "counters" && assets.length > 0
      ? await prisma.assetReading.findMany({
          where: { assetId: { in: assets.map((a) => a.id) } },
          orderBy: { createdAt: "desc" },
        })
      : [];
  const realReadingByKey = new Map<string, number>();
  for (const r of allReadings) {
    const key = `${r.assetId}:${r.tariffId}`;
    // allReadings отсортирован по убыванию createdAt — первое совпадение
    // по ключу и есть самое свежее.
    if (!realReadingByKey.has(key)) realReadingByKey.set(key, r.reading);
  }

  // Пока настоящих сдач ещё нет, "последнее показание" в списке — это
  // калибровочное значение (запрос пользователя 2026-07-14: ввёл начальное
  // показание, в списке ничего не появилось, потому что это разные таблицы).
  const initialByKey = await getInitialReadingsMap(assets.map((a) => a.id));
  const lastReadingByKey = new Map<string, number>([...initialByKey, ...realReadingByKey]);

  return NextResponse.json({
    id: zone.id,
    name: zone.name,
    iconKey: zone.iconKey,
    telegramEmoji: zone.telegramEmoji,
    accountingMode: zone.accountingMode,
    modeLocked: submissionCount > 0,
    active: zone.active,
    printReceiptEnabled: zone.printReceiptEnabled,
    pointId: zone.pointId,
    pointName: zone.point.name,
    tariffs,
    assets: assets.map((a) => ({
      ...a,
      lastReadings: tariffs
        .map((t) => ({ tariffId: t.id, reading: lastReadingByKey.get(`${a.id}:${t.id}`) }))
        .filter((r): r is { tariffId: string; reading: number } => r.reading !== undefined),
    })),
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/zones/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, id);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const { name, iconKey, telegramEmoji, accountingMode, active, printReceiptEnabled } = await request.json();
  const data: {
    name?: string;
    iconKey?: string | null;
    telegramEmoji?: string | null;
    accountingMode?: string;
    active?: boolean;
    printReceiptEnabled?: boolean;
  } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название зоны обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (iconKey !== undefined) {
    data.iconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
  }
  if (telegramEmoji !== undefined) {
    data.telegramEmoji = typeof telegramEmoji === "string" && telegramEmoji.trim() ? telegramEmoji.trim() : null;
  }
  if (accountingMode !== undefined) {
    if (!isZoneAccountingMode(accountingMode)) {
      return NextResponse.json({ error: "Некорректный режим учёта" }, { status: 400 });
    }
    const submissionCount = await prisma.zoneSubmission.count({ where: { zoneId: id } });
    if (submissionCount > 0) {
      return NextResponse.json(
        { error: "У зоны уже есть сдачи итогов — режим учёта менять нельзя." },
        { status: 409 }
      );
    }
    // Открытые пуски "Прибываний" осиротели бы: уйди зона из
    // accountingMode="stays", их некому будет остановить (экран пропадёт из
    // навигации) и они никогда не попадут в агрегат сдачи (тот считается
    // только для текущего режима на момент сдачи), docs/spec/04-game-room.md.
    if (zone.accountingMode === "stays") {
      const openLaunches = await prisma.launch.count({ where: { zoneId: id, isOpen: true } });
      if (openLaunches > 0) {
        return NextResponse.json(
          { error: `Заверши ${openLaunches} активных пусков, прежде чем менять режим учёта` },
          { status: 409 }
        );
      }
    }
    data.accountingMode = accountingMode;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение active" }, { status: 400 });
    }
    data.active = active;
  }
  if (printReceiptEnabled !== undefined) {
    if (typeof printReceiptEnabled !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение printReceiptEnabled" }, { status: 400 });
    }
    data.printReceiptEnabled = printReceiptEnabled;
  }
  await prisma.zone.update({ where: { id }, data });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/zones/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, id);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  // Same history guard as Point/Operator deletion — a Zone referenced by
  // submissions/money operations can't be hard-deleted without losing that
  // history (ZoneSubmission/MoneyOperation don't cascade from Zone).
  const [submissionCount, moneyOpCount] = await Promise.all([
    prisma.zoneSubmission.count({ where: { zoneId: id } }),
    prisma.moneyOperation.count({ where: { zoneId: id } }),
  ]);
  if (submissionCount > 0 || moneyOpCount > 0) {
    return NextResponse.json(
      { error: "У этой зоны есть история сдач итогов/операций — её нельзя удалить." },
      { status: 409 }
    );
  }

  await prisma.zone.delete({ where: { id } });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}
