import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/instructions/request-ip";
import { parseUserAgentLabels } from "@/lib/instructions/user-agent";
import { dispatchInstructionAcknowledgment } from "@/lib/summary-channels/dispatch";
import { INSTRUCTION_ACK_SUMMARY_DEFAULTS } from "@/lib/summary-settings";

// Приём подписания (docs/spec/07-instructions.md, "Подписание") — без
// авторизации, извне. Всё, что можно доверить клиенту (readingSeconds), не
// защищаем от манипуляций (спека explicitly), но валидируем обязательные
// поля и сам факт, что versionId реально принадлежит опубликованной
// инструкции по этим slug'ам — иначе можно было бы подписать чужую/архивную
// инструкцию, подставив произвольный versionId в теле запроса.

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_PER_IP = 5;

const MIN_SIGNATURE_BYTES = 100; // отсекает заведомо пустой canvas, не более того — см. комментарий выше
const MAX_SIGNATURE_BYTES = 500_000;

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const minDate = new Date("1900-01-01");
  return date >= minDate && date <= now;
}

function decodeSignaturePng(dataUrl: unknown): Buffer | null {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[1]!, "base64");
    if (buffer.length < MIN_SIGNATURE_BYTES || buffer.length > MAX_SIGNATURE_BYTES) return null;
    // Проверка PNG-сигнатуры (первые 8 байт) — не даём произвольный бинарник
    // выдать себя за PNG просто сменой префикса data URL.
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) return null;
    return buffer;
  } catch {
    return null;
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/public/instructions/[tenantSlug]/[instructionSlug]/sign">) {
  const { tenantSlug, instructionSlug } = await ctx.params;

  const instruction = await prisma.instruction.findFirst({
    where: { slug: instructionSlug, status: "published", tenant: { slug: tenantSlug } },
  });
  if (!instruction) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const { lastName, firstName, phone, birthDate, agreed, signature, readingSeconds, versionId } = body as Record<string, unknown>;

  if (typeof lastName !== "string" || !lastName.trim() || lastName.length > 100) {
    return NextResponse.json({ error: "Укажите фамилию" }, { status: 400 });
  }
  if (typeof firstName !== "string" || !firstName.trim() || firstName.length > 100) {
    return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
  }
  if (typeof phone !== "string" || !phone.trim() || phone.length > 32) {
    return NextResponse.json({ error: "Укажите телефон" }, { status: 400 });
  }
  if (!isValidDateString(birthDate)) {
    return NextResponse.json({ error: "Некорректная дата рождения" }, { status: 400 });
  }
  if (agreed !== true) {
    return NextResponse.json({ error: "Подтвердите согласие" }, { status: 400 });
  }
  if (typeof readingSeconds !== "number" || !Number.isFinite(readingSeconds) || readingSeconds < 0) {
    return NextResponse.json({ error: "Некорректное время чтения" }, { status: 400 });
  }
  if (typeof versionId !== "string") {
    return NextResponse.json({ error: "Некорректная версия" }, { status: 400 });
  }

  const signaturePng = decodeSignaturePng(signature);
  if (!signaturePng) {
    return NextResponse.json({ error: "Подпись не распознана" }, { status: 400 });
  }

  const version = await prisma.instructionVersion.findUnique({ where: { id: versionId } });
  if (!version || version.instructionId !== instruction.id) {
    return NextResponse.json({ error: "Версия инструкции не найдена" }, { status: 400 });
  }

  const ip = getClientIp(request);

  const recentCount = await prisma.acknowledgmentRecord.count({
    where: {
      instructionId: instruction.id,
      ip,
      createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000) },
    },
  });
  if (recentCount >= RATE_LIMIT_MAX_PER_IP) {
    return NextResponse.json({ error: "Слишком много попыток, попробуйте позже" }, { status: 429 });
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const { deviceLabel, browserLabel } = parseUserAgentLabels(userAgent);

  const record = await prisma.acknowledgmentRecord.create({
    data: {
      instructionId: instruction.id,
      versionId: version.id,
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      phone: phone.trim(),
      birthDate: new Date(birthDate),
      signaturePng: new Uint8Array(signaturePng),
      readingSeconds: Math.round(readingSeconds),
      ip,
      userAgent,
      deviceLabel,
      browserLabel,
    },
  });

  const instructionAckSettings =
    (await prisma.instructionAckSummarySettings.findUnique({ where: { tenantId: instruction.tenantId } })) ??
    INSTRUCTION_ACK_SUMMARY_DEFAULTS;
  if (instructionAckSettings.enabled) {
    dispatchInstructionAcknowledgment(instruction.tenantId, {
      fullName: `${record.lastName} ${record.firstName}`.trim(),
      instructionTitle: version.title,
      readingMinutes: Math.max(1, Math.round(record.readingSeconds / 60)),
    }).catch((err) => console.error("instruction ack dispatch failed", { instructionId: instruction.id, err }));
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
