// Единая анимация "галочки подтверждения" — используется и SaveButton
// (на кнопке), и SavedCheckmark (автосохранение по onChange, без кнопки,
// например Рабочее время) — решение пользователя 2026-07-16: "интерфейс
// должен быть идентичен", раньше это были два независимых, слегка разных
// куска кода. Keyframes 0 → 1.6 → 1 — заметный "вылет" за 100%, не просто
// scale-0→100 (по фидбеку пользователя это читалось как слишком незаметное).
export const CHECK_POP_KEYFRAMES = [0, 1.6, 1];
export const CHECK_POP_TRANSITION_IN = { duration: 0.45, times: [0, 0.55, 1], ease: "easeOut" as const };
export const CHECK_POP_TRANSITION_OUT = { duration: 0.15, ease: "easeIn" as const };

export function checkPopAnimate(show: boolean) {
  return { scale: show ? CHECK_POP_KEYFRAMES : 0 };
}

export function checkPopTransition(show: boolean) {
  return show ? CHECK_POP_TRANSITION_IN : CHECK_POP_TRANSITION_OUT;
}
