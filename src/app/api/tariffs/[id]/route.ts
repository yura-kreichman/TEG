import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { revalidateLandingForTenant } from "@/lib/landing/revalidate";
import { LAUNCH_PRICING_MODES } from "@/lib/game-room";
import { isStaysZone, isLaunchesZone } from "@/lib/results-calc";

async function findOwnedTariff(tenantId: string, id: string) {
  const tariff = await prisma.tariff.findUnique({
    where: { id },
    include: { zone: { include: { point: true } } },
  });
  if (!tariff || tariff.zone.point.tenantId !== tenantId) return null;
  return tariff;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/tariffs/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tariff = await findOwnedTariff(owner.tenantId, id);
  if (!tariff) {
    return NextResponse.json({ error: "Тариф не найден" }, { status: 404 });
  }

  const { name, price, pricingMode, options } = await request.json();
  const data: {
    name?: string;
    price?: string;
    pricingMode?: string | null;
    roundingMode?: string | null;
    minAmount?: number | null;
  } = {};
  // Варианты "За вход" — полная замена набора при сохранении (запрос
  // пользователя 2026-07-17: "можно добавлять, удалять и редактировать эти
  // опции"), проще, чем точечный diff по id, и достаточно для реалистичных
  // 2-4 вариантов на тариф. undefined — не трогать options вообще (например,
  // PATCH только name).
  let optionsData: { durationMinutes: number | null; price: number; order: number; name?: string }[] | undefined;

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Название тарифа обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }

  // pricingMode/минималка/варианты — только у тарифов зон "Прибывания";
  // у обычных зоновых тарифов (counters/launches) эти поля не применяются,
  // там цена приходит через price ниже, как и раньше.
  if (pricingMode !== undefined) {
    // "Пуски" с таймером (запрос пользователя 2026-07-28) — тот же тип
    // "fixed"/"За вход", что у "Прибываний", только без "per_minute"/"По
    // факту" — для мгновенного тапа по активу нет физического смысла.
    const zoneIsLaunches = isLaunchesZone(tariff.zone);
    if (!isStaysZone(tariff.zone) && !zoneIsLaunches) {
      return NextResponse.json({ error: "Этот тариф не принадлежит зоне режима «Прибывания» или «Пуски»" }, { status: 400 });
    }
    if (zoneIsLaunches && pricingMode === null) {
      // "Пуски": переключение обратно с "С таймером" на "Без таймера"
      // (реальный баг, найден пользователем 2026-07-28: раньше клиент в
      // этом случае вовсе не отправлял pricingMode, а PATCH без него
      // молчаливо НЕ трогал старое значение "fixed" — переключатель
      // визуально сбрасывался, но в БД тариф оставался таймерным) — тариф
      // становится обычным плоским, варианты удаляются, цена — из price
      // ниже (обычным полем формы, не через options).
      data.pricingMode = null;
      data.roundingMode = null;
      data.minAmount = null;
      optionsData = [];
      if (price !== undefined) {
        const numericPrice = Number(price);
        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
          return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
        }
        data.price = String(price);
      }
      await prisma.$transaction(async (tx) => {
        await tx.tariff.update({ where: { id }, data });
        await tx.tariffOption.deleteMany({ where: { tariffId: id } });
      });
      await revalidateLandingForTenant(owner.tenantId);
      return NextResponse.json({ ok: true });
    }
    if (!(LAUNCH_PRICING_MODES as readonly string[]).includes(pricingMode)) {
      return NextResponse.json({ error: "Некорректный тип тарифа" }, { status: 400 });
    }
    if (zoneIsLaunches && pricingMode !== "fixed") {
      return NextResponse.json({ error: "У «Пусков» доступен только тип «С длительностью»" }, { status: 400 });
    }
    data.pricingMode = pricingMode;
    if (pricingMode === "fixed") {
      if (!Array.isArray(options) || options.length === 0) {
        return NextResponse.json({ error: "Добавьте хотя бы один вариант" }, { status: 400 });
      }
      optionsData = [];
      for (const opt of options) {
        const o = opt as { name?: unknown; durationMinutes?: unknown; price?: unknown };
        const nm = typeof o?.name === "string" ? o.name.trim() : "";
        const p = Number(o?.price);
        // Безлимит (запрос пользователя 2026-09-01) — пустая длительность
        // значит «без ограничения времени». Ноль отвергаем: он занят под
        // именованные ставки «По факту» ниже.
        const unlimited = o?.durationMinutes == null || o?.durationMinutes === "";
        const d = unlimited ? null : Number(o?.durationMinutes);
        if (!nm || (d !== null && (!Number.isFinite(d) || d <= 0)) || !Number.isFinite(p) || p < 0) {
          return NextResponse.json({ error: "Некорректный вариант тарифа" }, { status: 400 });
        }
        optionsData.push({
          durationMinutes: d === null ? null : Math.round(d),
          price: p,
          order: optionsData.length,
          name: nm,
        });
      }
      data.roundingMode = null;
      data.minAmount = null;
      data.price = "0";
    } else {
      // Минимальная сумма пуска убрана (запрос пользователя 2026-07-17:
      // "вообще не нужна, это лишнее") — всегда null у "По факту".
      data.roundingMode = "up";
      data.minAmount = null;
      // Несколько именованных ставок (запрос пользователя 2026-07-26) — та же
      // логика создания выше (POST .../tariffs): options непустой массив
      // переключает тариф в режим списка ставок, иначе — обычная одна цена
      // в price, как раньше (обратная совместимость с уже существующими
      // тарифами "По факту" без вариантов).
      if (Array.isArray(options) && options.length > 0) {
        optionsData = [];
        for (const opt of options) {
          const o = opt as { name?: unknown; price?: unknown };
          const nm = typeof o?.name === "string" ? o.name.trim() : "";
          const p = Number(o?.price);
          if (!nm || !Number.isFinite(p) || p < 0) {
            return NextResponse.json({ error: "Некорректный вариант тарифа" }, { status: 400 });
          }
          optionsData.push({ durationMinutes: 0, price: p, order: optionsData.length, name: nm });
        }
        data.price = "0";
      } else {
        optionsData = [];
        if (price !== undefined) {
          const numericPrice = Number(price);
          if (!Number.isFinite(numericPrice) || numericPrice < 0) {
            return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
          }
          data.price = String(price);
        }
      }
    }
  } else if (price !== undefined) {
    const numericPrice = Number(price);
    if (typeof price !== "string" && typeof price !== "number") {
      return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return NextResponse.json({ error: "Цена должна быть неотрицательным числом" }, { status: 400 });
    }
    data.price = String(price);
  }

  await prisma.$transaction(async (tx) => {
    await tx.tariff.update({ where: { id }, data });
    if (optionsData !== undefined) {
      await tx.tariffOption.deleteMany({ where: { tariffId: id } });
      if (optionsData.length > 0) {
        await tx.tariffOption.createMany({
          data: optionsData.map((o) => ({ tariffId: id, ...o })),
        });
      }
    }
  });
  await revalidateLandingForTenant(owner.tenantId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/tariffs/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const tariff = await findOwnedTariff(owner.tenantId, id);
  if (!tariff) {
    return NextResponse.json({ error: "Тариф не найден" }, { status: 404 });
  }

  // Тариф, которым НИКОГДА не пользовались, удаляем НАСОВСЕМ (запрос
  // владельца 2026-09-03: «пользователи могут плодить тестовые тарифы, и они
  // будут зря накапливаться в базе»). У КидсБурга такой висел с 11 июля и
  // занимал строку «0 ₽ · 0%» в разбивке отчёта.
  //
  // Тариф С ИСТОРИЕЙ по-прежнему только помечается удалённым, и это не
  // осторожность ради осторожности: AssetReading, AssetInitialReading и
  // CounterTapEvent ссылаются на тариф с ON DELETE CASCADE. Жёсткое удаление
  // не упало бы с ошибкой FK — оно МОЛЧА унесло бы показания счётчиков и тапы,
  // то есть историю денег. (Прежний комментарий здесь утверждал обратное —
  // «без cascade» — и на этом основании объяснял soft-delete; проверено по
  // информационной схеме боевой базы 2026-09-03: каскад есть.)
  //
  // TariffOption в проверку НЕ входит: варианты «длительность+цена» — это
  // части самого тарифа, а не следы его использования, и уходят вместе с ним.
  // Asset.tariffId входит: тариф, назначенный активу по умолчанию, — это
  // настройка, которую жёсткое удаление обнулило бы молча (SET NULL).
  const used = await prisma.$transaction(async (tx) => {
    const [readings, initialReadings, taps, launches, abonementOps, assets] = await Promise.all([
      tx.assetReading.count({ where: { tariffId: id } }),
      tx.assetInitialReading.count({ where: { tariffId: id } }),
      tx.counterTapEvent.count({ where: { tariffId: id } }),
      tx.launch.count({ where: { tariffId: id } }),
      tx.abonementTransaction.count({ where: { tariffId: id } }),
      tx.asset.count({ where: { tariffId: id } }),
    ]);
    const total = readings + initialReadings + taps + launches + abonementOps + assets;
    if (total === 0) {
      await tx.tariff.delete({ where: { id } });
    } else {
      await tx.tariff.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    return total;
  });
  await revalidateLandingForTenant(owner.tenantId);
  // hardDeleted — чтобы поведение было видно снаружи, а не угадывалось по
  // тому, пропал тариф из отчётов или остался.
  return NextResponse.json({ ok: true, hardDeleted: used === 0 });
}
