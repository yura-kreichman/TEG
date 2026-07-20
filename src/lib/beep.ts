"use client";

// Звуковой сигнал истечения пуска (docs/spec/04-game-room.md, "Экран зоны в
// PWA") — Web Audio, не <audio>-файл: не нужно грузить/хостить asset ради
// одного тона. Браузеры блокируют AudioContext до первого пользовательского
// жеста — контекст создаётся лениво и переиспользуется, а не пересоздаётся
// на каждый сигнал (повторное создание тоже требует нового жеста).
let ctx: AudioContext | null = null;

/** Вызывать на любое раннее взаимодействие пользователя (тап), чтобы разблокировать звук заранее. */
export function unlockBeep() {
  if (ctx) return;
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  ctx = new AudioCtx();
}

export function playBeep() {
  if (!ctx) unlockBeep();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  // Два коротких тона — заметнее одиночного писка, не сливается с фоновым шумом игровой комнаты.
  // Громкость на максимуме (запрос пользователя 2026-07-17: "сделай
  // максимальную") — 1.0, unity gain, предел перед клиппингом синусоиды.
  for (const offset of [0, 0.22]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.2);
  }
}

function playTone(startAt: number, freq: number, duration: number, peakGain: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// Двухнотный сигнал подтверждения (запрос пользователя 2026-07-20, Пуски/
// Прибывания: "после выбора способа оплаты и подтверждения 'Точно'
// характерный звук из двух нот... звук громкий, приятный") — та же
// синусоида и огибающая, что у playBeep выше (проверенно приятная на слух),
// громкость на максимуме (1, unity gain, тот же выбор, что у playBeep).
// "Эхо" (по желанию пользователя, "можно с эхом") — не настоящий
// DelayNode/свёртка, а те же две ноты тише и чуть позже: тот же эффект на
// слух, без риска цифровой обратной связи.
function playTwoNoteChime(firstFreq: number, secondFreq: number) {
  if (!ctx) unlockBeep();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const noteDuration = 0.32;
  const gap = 0.16;
  playTone(now, firstFreq, noteDuration, 1);
  playTone(now + gap, secondFreq, noteDuration, 1);

  const echoDelay = 0.28;
  const echoGain = 0.28;
  playTone(now + echoDelay, firstFreq, noteDuration, echoGain);
  playTone(now + echoDelay + gap, secondFreq, noteDuration, echoGain);
}

/** "Бам-бум" — подтверждение (Пуски: тап учтён; Прибывания: браслет открыт). */
export function playConfirmChime() {
  playTwoNoteChime(660, 440);
}

/** "Бум-бам" — те же две ноты в обратном порядке (Прибывания: браслет закрыт). */
export function playCloseChime() {
  playTwoNoteChime(440, 660);
}
