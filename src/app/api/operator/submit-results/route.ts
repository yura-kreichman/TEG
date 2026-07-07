import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/require-operator";
import { calcSessions, calcZoneRevenue } from "@/lib/results-calc";
import { sendTenantTelegramMessage } from "@/lib/telegram";

interface ReadingInput {
  assetId: string;
  tariffId: string;
  reading: number;
}

interface ZoneSubmissionInput {
  zoneId: string;
  returnsCount: number;
  cashAmount: number;
  mobileAmount: number;
  readings: ReadingInput[];
}

interface ExpenseInput {
  zoneId: string;
  amount: number;
  comment?: string;
}

export async function POST(request: Request) {
  const ctx = await requireOperator();
  if (!ctx) {
    return NextResponse.json({ error: "Требуется вход оператора" }, { status: 401 });
  }
  const { operator, point } = ctx;

  const body = await request.json();
  const zoneSubmissions: ZoneSubmissionInput[] = body.zoneSubmissions ?? [];
  const expenses: ExpenseInput[] = body.expenses ?? [];

  if (!Array.isArray(zoneSubmissions) || zoneSubmissions.length === 0) {
    return NextResponse.json({ error: "Выберите хотя бы одну зону" }, { status: 400 });
  }

  // Re-derive everything server-side from the DB rather than trusting any
  // client-computed totals — the client only sends raw entered numbers.
  const zoneIds = zoneSubmissions.map((z) => z.zoneId);
  const zones = await prisma.zone.findMany({
    where: { id: { in: zoneIds }, pointId: point.id },
    include: { tariffs: true, assets: true },
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  if (zones.length !== zoneIds.length) {
    return NextResponse.json({ error: "Одна из зон не найдена" }, { status: 400 });
  }

  const allAssetIds = zoneSubmissions.flatMap((z) => z.readings.map((r) => r.assetId));
  const previousReadings = allAssetIds.length
    ? await prisma.assetReading.findMany({
        where: { assetId: { in: allAssetIds } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const previousByKey = new Map<string, number>();
  for (const reading of previousReadings) {
    const key = `${reading.assetId}:${reading.tariffId}`;
    if (!previousByKey.has(key)) previousByKey.set(key, reading.reading);
  }

  const summary = zoneSubmissions.map((zs) => {
    const zone = zoneById.get(zs.zoneId)!;
    const tariffCalc = zone.tariffs.map((tariff) => {
      const readingsForTariff = zs.readings.filter((r) => r.tariffId === tariff.id);
      const sessions = readingsForTariff.reduce((sum, r) => {
        const previous = previousByKey.get(`${r.assetId}:${tariff.id}`) ?? 0;
        return sum + calcSessions(r.reading, previous);
      }, 0);
      return { tariffId: tariff.id, price: Number(tariff.price), sessions };
    });

    const calculatedRevenue = calcZoneRevenue(tariffCalc, zs.returnsCount);
    const actualCash = zs.cashAmount + zs.mobileAmount;
    const difference = Math.round((actualCash - calculatedRevenue) * 100) / 100;

    const readingsText = zone.assets
      .map((asset) => {
        const values = zs.readings
          .filter((r) => r.assetId === asset.id)
          .map((r) => r.reading)
          .join("/");
        return `${asset.name}: ${values}`;
      })
      .join(", ");

    return {
      zoneId: zs.zoneId,
      zoneName: zone.name,
      calculatedRevenue,
      actualCash,
      difference,
      readingsText,
      returnsCount: zs.returnsCount,
      cashAmount: zs.cashAmount,
      mobileAmount: zs.mobileAmount,
    };
  });

  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.resultsSubmission.create({
      data: { tenantId: point.tenantId, pointId: point.id, operatorId: operator.id },
    });

    for (const zs of zoneSubmissions) {
      const zoneSubmission = await tx.zoneSubmission.create({
        data: {
          resultsSubmissionId: created.id,
          zoneId: zs.zoneId,
          returnsCount: zs.returnsCount,
          cashAmount: zs.cashAmount,
          mobileAmount: zs.mobileAmount,
        },
      });

      for (const reading of zs.readings) {
        await tx.assetReading.create({
          data: {
            zoneSubmissionId: zoneSubmission.id,
            assetId: reading.assetId,
            tariffId: reading.tariffId,
            reading: reading.reading,
          },
        });
      }

      const zoneExpenses = expenses.filter((e) => e.zoneId === zs.zoneId);
      for (const expense of zoneExpenses) {
        await tx.expenseEntry.create({
          data: {
            zoneSubmissionId: zoneSubmission.id,
            amount: expense.amount,
            comment: expense.comment || null,
          },
        });
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: zs.zoneId,
            type: "expense",
            amount: -Math.abs(expense.amount),
            performedByOperatorId: operator.id,
            comment: expense.comment || null,
            resultsSubmissionId: created.id,
          },
        });
      }

      if (zs.cashAmount > 0) {
        await tx.moneyOperation.create({
          data: {
            tenantId: point.tenantId,
            zoneId: zs.zoneId,
            type: "revenue",
            amount: zs.cashAmount,
            performedByOperatorId: operator.id,
            resultsSubmissionId: created.id,
          },
        });
      }
    }

    return created;
  });

  const totalCash = zoneSubmissions.reduce((sum, zs) => sum + zs.cashAmount, 0);
  const totalMobile = zoneSubmissions.reduce((sum, zs) => sum + zs.mobileAmount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const zoneBlocks = summary
    .map(
      (s) =>
        `Зона «${s.zoneName}»\nПоказания: ${s.readingsText}\nВозвраты/тесты: ${s.returnsCount}\nКасса vs счётчики: ${s.actualCash.toFixed(2)} / ${s.calculatedRevenue.toFixed(2)}\nРазница: ${s.difference > 0 ? "+" : ""}${s.difference.toFixed(2)}`
    )
    .join("\n\n");

  const message = [
    `Сдача итогов — ${point.name}`,
    zoneBlocks,
    `Касса\nОператор: ${operator.name}\nНаличные: ${totalCash.toFixed(2)}\nМобильный: ${totalMobile.toFixed(2)}\nРасходы: ${totalExpenses.toFixed(2)}`,
  ].join("\n\n");

  await sendTenantTelegramMessage(point.tenantId, message);

  return NextResponse.json({ id: submission.id, summary });
}
