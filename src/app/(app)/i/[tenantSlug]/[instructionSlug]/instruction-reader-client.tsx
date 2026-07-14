"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PressableScale } from "@/components/motion/pressable-scale";
import { InstructionEditor } from "@/components/instructions/instruction-editor";
import { SignatureCanvas, type SignatureCanvasHandle } from "@/components/instructions/signature-canvas";
import { useI18n } from "@/components/i18n-provider";
import type { PMNode } from "@/lib/instructions/content";

type LoadState = "loading" | "ready" | "not-found";
type Step = "reading" | "thanks";

interface InstructionData {
  tenantName: string;
  title: string;
  content: PMNode;
  versionId: string;
  honestyCheck: boolean;
  readingMinutes: number;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// border-input сливается с surface-0 на этой странице (тот же фикс, что для
// Checkbox/SignatureCanvas выше) — поля формы подписания должны явно
// читаться как поля ввода.
const FIELD_CLASS = "border-foreground/25 bg-white";

export default function InstructionReaderClient({
  tenantSlug,
  instructionSlug,
}: {
  tenantSlug: string;
  instructionSlug: string;
}) {
  const t = useI18n();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<InstructionData | null>(null);
  const [step, setStep] = useState<Step>("reading");

  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const signatureRef = useRef<SignatureCanvasHandle>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [readingSeconds, setReadingSeconds] = useState(0);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  useEffect(() => {
    fetch(`/api/public/instructions/${tenantSlug}/${instructionSlug}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((d: InstructionData) => {
        setData(d);
        setLoadState("ready");
      })
      .catch(() => setLoadState("not-found"));
  }, [tenantSlug, instructionSlug]);

  // Таймер чтения (docs/spec/07-instructions.md): от открытия до отправки, на
  // паузе, пока вкладка скрыта. Вспомогательная метрика — защищать от
  // манипуляций не нужно (спека explicitly), поэтому просто setInterval, без
  // криптографии/подписи на клиенте.
  useEffect(() => {
    if (loadState !== "ready" || step !== "reading") return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") setReadingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [loadState, step]);

  // Скролл-детекция для "Проверки честности" — порог ~95% высоты страницы.
  useEffect(() => {
    if (!data?.honestyCheck || step !== "reading") return;
    function handleScroll() {
      const reached = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight * 0.95;
      if (reached) setScrolledToEnd(true);
    }
    // Двойной rAF, не вызов сразу: InstructionEditor рендерит текст через
    // Tiptap асинхронно (immediatelyRender: false, нужно для SSR), сразу
    // после монтирования document.documentElement.scrollHeight ещё не
    // учитывает реальный текст инструкции — короткая пустая страница
    // ошибочно считалась бы "уже долистанной" (найдено визуальной
    // проверкой Шага 5). Два кадра гарантированно после того, как контент
    // осел в DOM.
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(handleScroll); // короткий текст может не требовать скролла вовсе
    });
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf1);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [data?.honestyCheck, step]);

  if (loadState === "loading") return null;

  if (loadState === "not-found") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-0 px-4 text-center">
        <p className="text-body-airbnb text-muted-foreground">{t.instructionsPublic.notAvailable}</p>
      </div>
    );
  }

  if (!data) return null;

  if (step === "thanks") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-surface-0 px-4 text-center">
        <h1 className="text-[1.375rem] font-semibold">{t.instructionsPublic.thanksTitle}</h1>
        <p className="text-body-airbnb text-muted-foreground">{t.instructionsPublic.thanksHint}</p>
      </div>
    );
  }

  const scrollBlocked = data.honestyCheck && !scrolledToEnd;
  const formValid = Boolean(lastName.trim() && firstName.trim() && phone.trim() && birthDate && agreed && !signatureEmpty);
  const canSubmit = formValid && !scrollBlocked && !submitting;

  async function handleSubmit() {
    if (!data || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/instructions/${tenantSlug}/${instructionSlug}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastName,
          firstName,
          phone,
          birthDate,
          agreed,
          signature: signatureRef.current?.toDataURL(),
          readingSeconds,
          versionId: data.versionId,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setSubmitError(errData.error ?? t.instructionsPublic.genericError);
        return;
      }
      setStep("thanks");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-surface-0 px-4 py-8">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FileText className="size-4" />
          </span>
          <span className="min-w-0 truncate text-caption-airbnb">
            {data.tenantName} · {t.instructionsPublic.badgeLabel}
          </span>
        </div>

        <h1 className="text-[1.5rem] leading-tight font-semibold">{data.title}</h1>

        <div className="flex items-center gap-1.5 text-caption-airbnb text-muted-foreground">
          <Clock className="size-3.5" />
          {t.instructionsPublic.readingTimeEstimate.replace("{count}", String(data.readingMinutes))}
        </div>

        <InstructionEditor content={data.content} editable={false} />

        <div className="my-1 border-t border-border" />

        <label className="flex items-start gap-3">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
          <span className="text-body-airbnb">{t.instructionsPublic.agreementText}</span>
        </label>

        {/* Видимые подписи над всеми полями, не только placeholder (нашёл
            пользователь: было непонятно, что поле даты — именно дата
            рождения; placeholder пропадает при вводе, подпись — нет).
            Плюс тот же "не видно на surface-0" фикс, что у Checkbox/
            SignatureCanvas: border-input сливался с фоном страницы —
            border-foreground/25 + белый фон читаются как реальное поле ввода. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="lastName" className="text-caption-airbnb">
              {t.instructionsPublic.lastNamePlaceholder}
            </Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="firstName" className="text-caption-airbnb">
              {t.instructionsPublic.firstNamePlaceholder}
            </Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="phone" className="text-caption-airbnb">
              {t.instructionsPublic.phonePlaceholder}
            </Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="birthDate" className="text-caption-airbnb">
              {t.instructionsPublic.birthDatePlaceholder}
            </Label>
            <Input
              id="birthDate"
              type="date"
              value={birthDate}
              max={toDateStr(new Date())}
              onChange={(e) => setBirthDate(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>{t.instructionsPublic.signatureLabel}</Label>
            <button
              type="button"
              onClick={() => signatureRef.current?.clear()}
              className="text-caption-airbnb font-semibold text-primary"
            >
              {t.instructionsPublic.clearSignature}
            </button>
          </div>
          <SignatureCanvas ref={signatureRef} onChange={setSignatureEmpty} />
        </div>

        {submitError && <p className="text-body-airbnb text-destructive">{submitError}</p>}

        <PressableScale>
          <Button type="button" className="h-[54px] w-full text-base" onClick={handleSubmit} disabled={!canSubmit}>
            {scrollBlocked ? t.instructionsPublic.scrollToEndHint : t.instructionsPublic.doneButton}
          </Button>
        </PressableScale>
      </div>
    </div>
  );
}
