import { describe, expect, it } from "vitest";
import { blocksResultsSubmission } from "./game-room-client";

// Клиентская копия правила countSubmissionBlockingLaunches (game-room.ts):
// мастер сдачи итогов по нему серит актив и кнопку «Далее», сервер по своему
// отклоняет сдачу. Разойдутся — сотрудник увидит одно, а сервер сделает другое.
describe("blocksResultsSubmission — что мешает сдать итоги (docs/spec/04-game-room.md, пересменка)", () => {
  it("идущий «По факту» не мешает: его оплата войдёт в следующую сдачу", () => {
    expect(blocksResultsSubmission({ isOpen: true, pricingMode: "per_minute" })).toBe(false);
  });
  it("идущий «За вход» мешает: деньги уже в ящике, а в сдачу пуск попадёт по остановке", () => {
    expect(blocksResultsSubmission({ isOpen: true, pricingMode: "fixed" })).toBe(true);
  });
  it("«По факту», ждущий способ оплаты, мешает: время остановки уже записано", () => {
    expect(blocksResultsSubmission({ isOpen: false, pricingMode: "per_minute" })).toBe(true);
  });
  it("незнакомый режим считаем мешающим: безопаснее заблокировать, чем потерять деньги", () => {
    expect(blocksResultsSubmission({ isOpen: true, pricingMode: "something_new" })).toBe(true);
  });
});
