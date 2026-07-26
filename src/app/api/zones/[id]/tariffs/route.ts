import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { findTenantZone, requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { LAUNCH_PRICING_MODES, smallestFreeNumber } from "@/lib/game-room";
import { isStaysZone } from "@/lib/results-calc";

export async function POST(request: Request, ctx: RouteContext<"/api/zones/[id]/tariffs">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id: zoneId } = await ctx.params;
  const zone = await findTenantZone(owner.tenantId, zoneId);
  if (!zone) {
    return NextResponse.json({ error: "Зона не найдена" }, { status: 404 });
  }

  const activeTariffs = await prisma.tariff.findMany({
    where: { zoneId, deletedAt: null },
    select: { order: true },
  });
  // Лимит "максимум 2" — только у Счётчиков, аппаратно обоснован (запрос
  // пользователя 2026-07-27: "Счётчики — это аппаратные устройства... в
  // других режимах учёта их нет"). Раньше действовал везде (запрос
  // 2026-07-17: "здесь действуют те же правила и лимит тарифов"), решение
  // пересмотрено.
  if (zone.accountingMode === "counters" && activeTariffs.length >= 2) {
    return NextResponse.json(
      { error: "У зоны уже максимум 2 тарифа" },
      { status: 409 }
    );
  }
  // @@unique([zoneId, order]) — после soft-delete тарифа с order=1 может
  // остаться активный только с order=2, тогда новому нужен именно order=1,
  // не "count+1" (это дало бы конфликт с уже занятым order=2). Наименьший
  // свободный, не только 1/2 (та же smallestFreeNumber, что у номеров
  // пусков/браслетов) — с 2026-07-27 у Прибываний/Пусков/Только касса
  // тарифов может быть больше двух.
  const order = smallestFreeNumber(activeTariffs.map((t) => t.order));

  const { name, price, pricingMode, options } = await request.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Название тарифа обязательно" }, { status: 400 });
  }

  // "За вход"/"По факту" — только у зон "Прибывания" (запрос пользователя
  // 2026-07-17: та же карточка "Тарифы", что у Счётчиков/Пусков, просто с
  // доп. полями, значимыми только в этом режиме; лимит "макс. 2" — только у
  // Счётчиков, см. проверку выше). Минимальная сумма
  // пуска убрана (запрос пользователя того же дня: "вообще не нужна, это
  // лишнее") — roundingMode остаётся "up" для округления длительности,
  // minAmount всегда null у новых тарифов "По факту".
  let pricingModeValue: string | null = null;
  let roundingModeValue: string | null = null;
  let priceNumber = 0;
  const optionsData: { durationMinutes: number; price: number; order: number; name?: string }[] = [];

  if (isStaysZone(zone)) {
    if (!(LAUNCH_PRICING_MODES as readonly string[]).includes(pricingMode)) {
      return NextResponse.json({ error: "Некорректный тип тарифа" }, { status: 400 });
    }
    pricingModeValue = pricingMode;
    if (pricingMode === "fixed") {
      // Несколько вариантов длительность+цена (запрос пользователя
      // 2026-07-17: "1 час, 2 часа..." — оператор выбирает при старте пуска),
      // а не одна пара — top-level price для "fixed" не используется.
      if (!Array.isArray(options) || options.length === 0) {
        return NextResponse.json({ error: "Добавьте хотя бы один вариант" }, { status: 400 });
      }
      for (const opt of options) {
        const o = opt as { name?: unknown; durationMinutes?: unknown; price?: unknown };
        const nm = typeof o?.name === "string" ? o.name.trim() : "";
        const d = Number(o?.durationMinutes);
        const p = Number(o?.price);
        if (!nm || !Number.isFinite(d) || d <= 0 || !Number.isFinite(p) || p < 0) {
          return NextResponse.json({ error: "Некорректный вариант тарифа" }, { status: 400 });
        }
        optionsData.push({ durationMinutes: Math.round(d), price: p, order: optionsData.length, name: nm });
      }
    } else {
      roundingModeValue = "up";
      // Несколько именованных ставок на выбор оператора при старте (запрос
      // пользователя 2026-07-26: "в выходные один тариф, в будние другой") —
      // необязательно, по умолчанию единая цена в price ниже, та же логика,
      // что options у "fixed" выше, только с name вместо durationMinutes
      // (у "per_minute" нет естественной длительности-подписи).
      if (Array.isArray(options) && options.length > 0) {
        for (const opt of options) {
          const o = opt as { name?: unknown; price?: unknown };
          const nm = typeof o?.name === "string" ? o.name.trim() : "";
          const p = Number(o?.price);
          if (!nm || !Number.isFinite(p) || p < 0) {
            return NextResponse.json({ error: "Некорректный вариант тарифа" }, { status: 400 });
          }
          optionsData.push({ durationMinutes: 0, price: p, order: optionsData.length, name: nm });
        }
      } else {
        priceNumber = Number(price);
        if (!Number.isFinite(priceNumber) || priceNumber < 0) {
          return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
        }
      }
    }
  } else {
    priceNumber = Number(price);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    }
  }

  // order вычислен ВЫШЕ, вне транзакции/лока — двойной клик "Добавить тариф"
  // мог посчитать одинаковый order дважды; целостность спасает partial unique
  // index Tariff_zoneId_order_active_key (@@unique(zoneId, order) WHERE
  // deletedAt IS NULL), но без обработки P2002 проигравший запрос долетал
  // до клиента необработанной 500 вместо понятной 409 (аудит 2026-07-24).
  let tariff;
  try {
    tariff = await prisma.$transaction(async (tx) => {
      const created = await tx.tariff.create({
        data: {
          zoneId,
          name: name.trim(),
          price: priceNumber,
          order,
          pricingMode: pricingModeValue,
          roundingMode: roundingModeValue,
          minAmount: null,
        },
      });
      if (optionsData.length > 0) {
        await tx.tariffOption.createMany({
          data: optionsData.map((o) => ({ tariffId: created.id, ...o })),
        });
      }
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Гонка на order при двойном клике "Добавить тариф" (комментарий выше)
      // — не обязательно "максимум 2" теперь, раз лимит только у Счётчиков.
      return NextResponse.json({ error: "Повторите — не удалось сохранить тариф, попробуйте ещё раз" }, { status: 409 });
    }
    throw err;
  }

  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json(
    { id: tariff.id, name: tariff.name, price: tariff.price, order: tariff.order },
    { status: 201 }
  );
}
