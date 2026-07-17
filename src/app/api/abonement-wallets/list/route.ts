import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { normalizePhone } from "@/lib/abonement";

// Список кошельков клиентов тенанта (запрос пользователя 2026-07-17:
// "у владельца так и не виден список активных абонентов") — read-only обзор
// для владельца: посмотреть/найти клиента и его баланс. Отдельный роут от
// /api/abonement-wallets (тот — точный поиск по телефону для потока продажи/
// пополнения, другая форма ответа), не смешиваем.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const phoneQuery = q ? normalizePhone(q) : "";

  const wallets = await prisma.abonementWallet.findMany({
    where: {
      tenantId: owner.tenantId,
      ...(q
        ? {
            OR: [
              ...(phoneQuery ? [{ phone: { contains: phoneQuery } }] : []),
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    wallets: wallets.map((w) => ({
      id: w.id,
      phone: w.phone,
      name: w.name,
      balance: Number(w.balance),
      createdAt: w.createdAt,
    })),
  });
}
