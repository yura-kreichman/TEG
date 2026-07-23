import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { deleteUploadedImage } from "@/lib/uploads";
import { getOpenShift, isTimeTrackingMode } from "@/lib/work-time";
import { isLocale } from "@/lib/locales";

export async function GET(_request: Request, ctx: RouteContext<"/api/operators/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await prisma.operator.findUnique({
    where: { id },
    include: { allowedZones: { select: { id: true, name: true, pointId: true } } },
  });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  // Для предупреждения владельцу перед деактивацией (docs/spec/05-work-time.md,
  // "РЕЖИМ УЧЁТА ВРЕМЕНИ") — деактивация не блокируется, но открытая смена
  // "осиротеет" (оператор больше не сможет её закрыть сам), стоит показать.
  const hasOpenShift = (await getOpenShift(id)) !== null;

  return NextResponse.json({
    id: operator.id,
    name: operator.name,
    active: operator.active,
    avatarUrl: operator.avatarUrl,
    iconKey: operator.iconKey,
    colorTag: operator.colorTag,
    pin: operator.pin,
    allZonesAccess: operator.allZonesAccess,
    allowedZones: operator.allowedZones,
    timeTrackingMode: operator.timeTrackingMode,
    overdraftAllowed: operator.overdraftAllowed,
    skipShiftStartWindow: operator.skipShiftStartWindow,
    goodsAccess: operator.goodsAccess,
    revisionAccess: operator.revisionAccess,
    ticketsAccess: operator.ticketsAccess,
    // null = следует языку тенанта (prisma/schema.prisma) — персональный
    // оверрайд, который раньше нечем было сбросить обратно (аудит
    // 2026-07-24): один ПИН-вход на устройстве с ранее переключённым языком
    // экрана входа молча цементировал его в Operator.locale навсегда, смена
    // языка тенанта в Настройках владельца этого оператора больше не
    // касалась.
    locale: operator.locale,
    hasOpenShift,
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/operators/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await prisma.operator.findUnique({ where: { id } });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  const {
    name,
    avatarUrl,
    iconKey,
    active,
    allZonesAccess,
    zoneIds,
    colorTag,
    timeTrackingMode,
    overdraftAllowed,
    skipShiftStartWindow,
    goodsAccess,
    revisionAccess,
    ticketsAccess,
    locale,
  } = await request.json();
  const data: {
    name?: string;
    avatarUrl?: string | null;
    iconKey?: string | null;
    active?: boolean;
    allZonesAccess?: boolean;
    allowedZones?: { set: { id: string }[] };
    colorTag?: string | null;
    timeTrackingMode?: string;
    overdraftAllowed?: boolean;
    skipShiftStartWindow?: boolean;
    goodsAccess?: boolean;
    revisionAccess?: boolean;
    ticketsAccess?: boolean;
    locale?: string | null;
  } = {};
  // null — явный сброс оверрайда, "следовать языку тенанта" (аудит
  // 2026-07-24) — единственный способ достать оператора из зацементированного
  // при логине персонального языка.
  if (locale !== undefined) {
    if (locale !== null && !isLocale(locale)) {
      return NextResponse.json({ error: "Некорректный язык" }, { status: 400 });
    }
    data.locale = locale;
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Имя оператора обязательно" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (colorTag !== undefined) {
    data.colorTag = typeof colorTag === "string" && colorTag.trim() ? colorTag.trim() : null;
  }
  // Фото и SVG-аватар взаимоисключающие (фидбек 2026-07-12: выбор иконки
  // не заменял ранее загруженное фото — оба поля хранились независимо, а
  // экран профиля показывает avatarUrl первым в приоритете, так что фото
  // молча "побеждало" и оставалось видимым). Установка одного всегда
  // очищает другое.
  if (avatarUrl !== undefined) {
    const nextAvatarUrl = typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl.trim() : null;
    if (operator.avatarUrl && operator.avatarUrl !== nextAvatarUrl) {
      await deleteUploadedImage(operator.avatarUrl);
    }
    data.avatarUrl = nextAvatarUrl;
    if (nextAvatarUrl) data.iconKey = null;
  }
  if (iconKey !== undefined) {
    const nextIconKey = typeof iconKey === "string" && iconKey.trim() ? iconKey.trim() : null;
    data.iconKey = nextIconKey;
    if (nextIconKey) {
      if (operator.avatarUrl) await deleteUploadedImage(operator.avatarUrl);
      data.avatarUrl = null;
    }
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение active" }, { status: 400 });
    }
    data.active = active;
  }
  if (allZonesAccess !== undefined) {
    if (typeof allZonesAccess !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение allZonesAccess" }, { status: 400 });
    }
    data.allZonesAccess = allZonesAccess;
  }
  if (zoneIds !== undefined) {
    if (!Array.isArray(zoneIds) || !zoneIds.every((z) => typeof z === "string")) {
      return NextResponse.json({ error: "Некорректный список зон" }, { status: 400 });
    }
    const validCount = zoneIds.length
      ? await prisma.zone.count({ where: { id: { in: zoneIds }, point: { tenantId: owner.tenantId } } })
      : 0;
    if (validCount !== zoneIds.length) {
      return NextResponse.json({ error: "Одна из зон не найдена" }, { status: 400 });
    }
    data.allowedZones = { set: zoneIds.map((zoneId: string) => ({ id: zoneId })) };
  }
  if (timeTrackingMode !== undefined) {
    if (!isTimeTrackingMode(timeTrackingMode)) {
      return NextResponse.json({ error: "Некорректный режим учёта времени" }, { status: 400 });
    }
    // Уводить режим из-под открытой смены нельзя — в "ручном" у оператора
    // больше не будет кнопки "Закончить смену", чтобы её закрыть самому.
    if (timeTrackingMode !== "auto" && (await getOpenShift(id))) {
      return NextResponse.json(
        { error: "У оператора сейчас открыта смена — сначала закройте её (в табеле), потом меняйте режим" },
        { status: 409 }
      );
    }
    data.timeTrackingMode = timeTrackingMode;
  }
  if (overdraftAllowed !== undefined) {
    if (typeof overdraftAllowed !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение overdraftAllowed" }, { status: 400 });
    }
    data.overdraftAllowed = overdraftAllowed;
  }
  if (skipShiftStartWindow !== undefined) {
    if (typeof skipShiftStartWindow !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение skipShiftStartWindow" }, { status: 400 });
    }
    data.skipShiftStartWindow = skipShiftStartWindow;
  }
  if (goodsAccess !== undefined) {
    if (typeof goodsAccess !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение goodsAccess" }, { status: 400 });
    }
    data.goodsAccess = goodsAccess;
  }
  if (revisionAccess !== undefined) {
    if (typeof revisionAccess !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение revisionAccess" }, { status: 400 });
    }
    data.revisionAccess = revisionAccess;
  }
  if (ticketsAccess !== undefined) {
    if (typeof ticketsAccess !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение ticketsAccess" }, { status: 400 });
    }
    data.ticketsAccess = ticketsAccess;
  }

  await prisma.operator.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/operators/[id]">) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const operator = await prisma.operator.findUnique({ where: { id } });
  if (!operator || operator.tenantId !== owner.tenantId) {
    return NextResponse.json({ error: "Оператор не найден" }, { status: 404 });
  }

  // Operators referenced by historical records can't be hard-deleted without
  // orphaning/losing that history — deactivate instead (see
  // /api/operators/[id]/deactivate). Only a never-used operator can actually
  // be removed. Изначально (до 2026-07-14) здесь проверялись только
  // resultsSubmission и MoneyOperation.performedByOperatorId — реальная дыра:
  // Shift.operatorId и OperatorBalanceCarryover.operatorId в schema.prisma
  // объявлены с onDelete: Cascade (см. migration.sql
  // 20260708100600_add_work_time_module), то есть удаление оператора молча
  // стирало весь табель и перенос баланса, если у него не было ни одной
  // сдачи итогов и он сам не проводил операции. MoneyOperation.beneficiaryOperatorId
  // (аванс/премия ПОЛУЧЕНЫ этим оператором, а не проведены им) — onDelete:
  // SetNull, тоже не ловилось прежней проверкой: операция в журнале
  // оставалась, но обезличивалась (терялось "кому").
  const [submissionCount, moneyOpCount, beneficiaryMoneyOpCount, shiftCount, balanceCarryoverCount, assignedTaskCount] =
    await Promise.all([
      prisma.resultsSubmission.count({ where: { operatorId: id } }),
      prisma.moneyOperation.count({ where: { performedByOperatorId: id } }),
      prisma.moneyOperation.count({ where: { beneficiaryOperatorId: id } }),
      prisma.shift.count({ where: { operatorId: id } }),
      prisma.operatorBalanceCarryover.count({ where: { operatorId: id } }),
      // _TaskAssignedOperators — ON DELETE CASCADE, поэтому без этой проверки
      // удаление не оставляет осиротевших строк в БД, но задача, назначенная
      // ИСКЛЮЧИТЕЛЬНО этому оператору, молча становится видимой ВСЕМ
      // операторам точки (правило "пусто в assignedOperators = видят все") —
      // без единого предупреждения владельцу (аудит 2026-07-24).
      prisma.task.count({ where: { assignedOperators: { some: { id } } } }),
    ]);
  if (
    submissionCount > 0 ||
    moneyOpCount > 0 ||
    beneficiaryMoneyOpCount > 0 ||
    shiftCount > 0 ||
    balanceCarryoverCount > 0 ||
    assignedTaskCount > 0
  ) {
    return NextResponse.json(
      {
        error:
          "У этого оператора есть история сдач итогов, табеля, денежных операций (включая авансы/премии) или назначенные задачи — его нельзя удалить безвозвратно, только деактивировать.",
      },
      { status: 409 }
    );
  }

  await prisma.operator.delete({ where: { id } });
  await deleteUploadedImage(operator.avatarUrl);
  return NextResponse.json({ ok: true });
}
