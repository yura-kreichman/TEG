import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/require-owner";
import { generateUniqueSlug } from "@/lib/instructions/slug";
import { isModuleEnabled } from "@/lib/tenant-modules";

const EMPTY_DOC = { type: "doc", content: [] };

export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  // Настройки → Система → "Модули" (запрос пользователя 2026-07-22) —
  // владелец мог выключить модуль целиком.
  if (!(await isModuleEnabled(owner.tenantId, "instructionsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const [instructions, tenant] = await Promise.all([
    prisma.instruction.findMany({
      where: { tenantId: owner.tenantId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { records: true } } },
    }),
    prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: { slug: true } }),
  ]);

  return NextResponse.json({
    tenantSlug: tenant?.slug ?? null,
    instructions: instructions.map((i) => ({
      id: i.id,
      title: i.title,
      slug: i.slug,
      status: i.status,
      currentVersionNumber: i.currentVersionNumber,
      recordsCount: i._count.records,
      honestyCheck: i.honestyCheck,
      createdAt: i.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }
  if (!(await isModuleEnabled(owner.tenantId, "instructionsEnabled"))) {
    return NextResponse.json({ error: "Модуль отключён" }, { status: 403 });
  }

  const { title } = await request.json().catch(() => ({}));
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
  }

  const slug = await generateUniqueSlug(title, async (candidate) => {
    const existing = await prisma.instruction.findUnique({
      where: { tenantId_slug: { tenantId: owner.tenantId, slug: candidate } },
    });
    return !!existing;
  });

  const instruction = await prisma.instruction.create({
    data: { tenantId: owner.tenantId, title: title.trim(), slug, content: EMPTY_DOC },
  });

  return NextResponse.json({ id: instruction.id }, { status: 201 });
}
