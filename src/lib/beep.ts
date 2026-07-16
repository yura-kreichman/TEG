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
  for (const offset of [0, 0.22]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.2);
  }
}
