"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

type ConnState = "loading" | "wait" | "done";

// Прототип docs/design/prototype-telegram-summaries-v1.html, sheet-connect:
// loading (POST .../bind сразу при открытии шторки) -> wait (poll .../status
// до chatStatus=active, ссылка "Открыть Telegram" — настоящий <a href>) ->
// done. Раньше ссылка открывалась через window.open('', '_blank') с
// подстановкой location.href после await — на Android это ненадёжно для
// App Links (переход после await не всегда засчитывается как прямой отклик
// на клик пользователя, из-за чего Telegram может не подхватить intent —
// экран "мигал" и падал назад в ожидание). Убрано в пользу единственного
// способа, который реально гарантирован документацией — прямой клик по <a>.
export function TelegramConnectSheet({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useI18n();
  const [botConfigured, setBotConfigured] = useState(true);
  const [connState, setConnState] = useState<ConnState>("loading");
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function loadStatus() {
    const res = await fetch("/api/tenant/summary-channels/telegram/status");
    if (!res.ok) return null;
    const data = await res.json();
    setBotConfigured(data.botConfigured);
    if (data.connected) {
      setChatTitle(data.chatTitle);
      setConnState("done");
      stopPolling();
    }
    return data;
  }

  async function startBind() {
    const res = await fetch("/api/tenant/summary-channels/telegram/bind", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setBotConfigured(false);
      return;
    }
    setCode(data.code);
    setDeepLink(data.deepLink ?? null);
    setConnState("wait");
    pollRef.current = setInterval(async () => {
      const s = await loadStatus();
      if (s?.connected) onChanged();
    }, 2000);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      stopPolling();
      return;
    }
    setTestResult(null);
    setConnState("loading");
    loadStatus().then((s) => {
      if (!s?.connected && s?.botConfigured) startBind();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => stopPolling(), []);

  function cancelBind() {
    stopPolling();
    onClose();
  }

  async function handleDisconnect() {
    await fetch("/api/tenant/summary-channels/telegram/disconnect", { method: "POST" });
    setChatTitle(null);
    setConnState("loading");
    onChanged();
  }

  async function handleTest() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/tenant/summary-channels/telegram/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error ?? t.summaries.genericError });
        return;
      }
      setTestResult({
        ok: true,
        message: `${t.summaries.testOkPrefix} «${chatTitle}». ${t.summaries.testOkSuffix}`,
      });
    } finally {
      setTestLoading(false);
    }
  }

  function handleClose() {
    stopPolling();
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div className="flex flex-col gap-1 pt-2 pb-1">
        <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{t.summaries.connectSheetTitle}</h2>
        <p className="mb-3 text-caption-airbnb">{t.summaries.connectSheetSub}</p>

        {!botConfigured && (
          <p className="rounded-control bg-destructive/10 p-3 text-body-airbnb text-destructive">
            {t.summaries.connectBotNotConfigured}
          </p>
        )}

        {botConfigured && connState === "loading" && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {connState === "wait" && (
          <>
            {deepLink && (
              <PressableScale>
                <a
                  href={deepLink}
                  className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-transparent bg-linear-to-b from-primary to-[color-mix(in_oklch,var(--primary),black_14%)] text-sm font-medium text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,.12),inset_0_1px_0_rgba(255,255,255,.16)]"
                >
                  <Send className="size-4" />
                  {t.summaries.connectOpenTelegramButton}
                </a>
              </PressableScale>
            )}
            <div className="mt-3 flex items-start gap-2.5 rounded-control bg-muted/50 p-3 text-body-airbnb text-muted-foreground">
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
              <span>
                {t.summaries.connectWaitPrefix} <b className="tabular-nums text-foreground">{code}</b>{" "}
                {t.summaries.connectWaitSuffix}
              </span>
            </div>
            <PressableScale className="mt-3">
              <Button type="button" variant="outline" className="w-full" onClick={cancelBind}>
                {t.summaries.connectCancelButton}
              </Button>
            </PressableScale>
          </>
        )}

        {connState === "done" && (
          <>
            <div className="flex items-start gap-2.5 rounded-control bg-primary/10 p-3 text-body-airbnb text-primary">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>
                  {t.summaries.connectDoneConnectedPrefix} «{chatTitle}»
                </b>
                <br />
                {t.summaries.connectDoneHint}
              </span>
            </div>

            <PressableScale className="mt-3">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handleTest}
                disabled={testLoading}
              >
                {testLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {testLoading ? t.summaries.testSending : t.summaries.testMessageButton}
              </Button>
            </PressableScale>

            {testResult && (
              <p
                className={cn(
                  "mt-2.5 rounded-control p-3 text-body-airbnb",
                  testResult.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                )}
              >
                {testResult.message}
              </p>
            )}

            <PressableScale className="mt-3">
              <Button type="button" className="w-full" onClick={handleClose}>
                {t.summaries.doneButton}
              </Button>
            </PressableScale>
            <button
              type="button"
              onClick={handleDisconnect}
              className="mx-auto mt-3.5 block text-caption-airbnb font-semibold text-destructive"
            >
              {t.summaries.disconnectButton}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
