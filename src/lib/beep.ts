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

function playTone(startAt: number, freq: number, duration: number, peakGain: number, type: OscillatorType = "sine") {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
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

// "Мягкий дзинь" — одобрительный звук при "Сохранено" (запрос пользователя
// 2026-07-20: "всегда когда... вылетает зелёная галочка... по всему
// проекту у всех") — тише и короче двухнотного сигнала выше (тот звучит
// эпизодически при пусках/прибываниях, этот — при КАЖДОМ сохранении, часто
// подряд, поэтому громкость сознательно ниже, не unity gain). Ровно те же
// частоты/тайминги/громкость, что пользователь прослушал и выбрал в
// артефакте-превью — сюрпризов между "послушал" и "получил" быть не должно.
export function playSaveDing() {
  if (!ctx) unlockBeep();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  playTone(now, 784, 0.16, 0.4); // G5
  playTone(now + 0.09, 988, 0.22, 0.45); // B5
}

// Начало и конец смены (docs/spec/05-work-time.md, режим учёта "Авто";
// выбор пользователя 2026-08-13 из трёх кандидатов, прослушанных вживую) —
// восходящее мажорное трезвучие и его точное зеркало. Три ноты, а не две:
// смена начинается раз в день, сигнал не соревнуется с операционными
// звуками пусков/сохранений и может позволить себе быть длиннее. Громкость
// 0.7 — между "дзинем" (0.4) и пусками (unity gain): заметнее рядового
// сохранения, но не перекрикивает сигнал истёкшего пуска. Эха нет
// сознательно: эхо в этом приложении — почерк пусков, не смены.
const SHIFT_NOTES = [523.25, 659.25, 784] as const; // C5 · E5 · G5
const SHIFT_STEP = 0.14;
const SHIFT_GAIN = 0.7;

function playShiftTriad(descending: boolean) {
  if (!ctx) unlockBeep();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const notes = descending ? [...SHIFT_NOTES].reverse() : [...SHIFT_NOTES];
  notes.forEach((freq, i) => {
    // Последняя нота длиннее остальных — иначе трезвучие обрывается, а не
    // договаривает.
    playTone(now + i * SHIFT_STEP, freq, i === notes.length - 1 ? 0.34 : 0.28, SHIFT_GAIN);
  });
}

/** Трезвучие вверх C5→E5→G5 — сотрудник начал смену (check-in). */
export function playShiftStartChime() {
  playShiftTriad(false);
}

/** Те же три ноты вниз G5→E5→C5 — сотрудник закончил смену (check-out). */
export function playShiftEndChime() {
  playShiftTriad(true);
}

// Отмена/удаление (выбор пользователя 2026-08-13) — две короткие ноты вниз,
// вдвое тише "дзиня" сохранения. Намеренно НЕ playErrorChime ниже: удаление
// тапа, расхода или заказа — нормальная работа сотрудника, а не сбой, и
// жужжащая square-волна читалась бы как "ты сломал". И намеренно не
// playSaveDing: до 2026-08-13 аннулирование заказа звучало ровно как
// продажа — единственный звук в приложении, который вводил в заблуждение.
export function playUndoTone() {
  if (!ctx) unlockBeep();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  playTone(now, 493.88, 0.12, 0.3); // B4
  playTone(now + 0.08, 392, 0.16, 0.3); // G4
}

// "Жужжащий" нисходящий сигнал ошибки (запрос пользователя 2026-07-21:
// "заказ не найден... с характерным звуком ошибки") — square-волна вместо
// синуса и нисходящий тон намеренно противопоставлены приятным
// playConfirmChime/playSaveDing выше, читаются как "не то", не "успех".
export function playErrorChime() {
  if (!ctx) unlockBeep();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  for (const [offset, freq] of [
    [0, 220],
    [0.14, 165],
  ] as [number, number][]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.15);
  }
}
