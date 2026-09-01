import { describe, expect, it } from "vitest";
import {
  classifyClientQuery,
  isCreatableClientPhone,
  isSearchableClientQuery,
  normalizePhone,
} from "./client-query";

describe("classifyClientQuery", () => {
  it("считает номером всё от 8 цифр — как записан, так и разобранный", () => {
    expect(classifyClientQuery("77795928")).toBe("phone");
    expect(classifyClientQuery("+373 777 95 928")).toBe("phone");
    expect(classifyClientQuery("(079) 42-42-42")).toBe("phone");
  });

  it("4–7 цифр — хвост номера, только список кандидатов", () => {
    expect(classifyClientQuery("4242")).toBe("tail");
    expect(classifyClientQuery("95 928")).toBe("tail");
    expect(classifyClientQuery("7795928")).toBe("tail");
  });

  it("меньше четырёх цифр не ищем вовсе", () => {
    expect(classifyClientQuery("424")).toBe("tooShort");
    expect(classifyClientQuery("7")).toBe("tooShort");
    expect(classifyClientQuery("")).toBe("empty");
    expect(classifyClientQuery("   ")).toBe("empty");
  });

  it("любая буква переводит запрос в поиск по имени", () => {
    expect(classifyClientQuery("Иван")).toBe("name");
    expect(classifyClientQuery("Петров Иван")).toBe("name");
    expect(classifyClientQuery("Ion")).toBe("name");
    // Имя с цифрой — всё равно имя: цифры сами по себе номером не делают,
    // иначе "Анна 2" пошла бы искаться как телефон.
    expect(classifyClientQuery("Анна 2")).toBe("name");
  });
});

describe("isSearchableClientQuery", () => {
  it("пускает искать имя, хвост и полный номер", () => {
    expect(isSearchableClientQuery("Иван")).toBe(true);
    expect(isSearchableClientQuery("4242")).toBe(true);
    expect(isSearchableClientQuery("37377795928")).toBe(true);
  });

  it("не пускает пустую строку и огрызок из трёх цифр", () => {
    expect(isSearchableClientQuery("")).toBe(false);
    expect(isSearchableClientQuery("424")).toBe(false);
  });
});

describe("isCreatableClientPhone", () => {
  // Главное, ради чего порог заведён: до этой правки поиск, ничего не найдя,
  // предлагал завести клиента с номером «4242» — мусорная строка навсегда
  // занимала бы @@unique([tenantId, phone]) и не сошлась бы ни с ботом, ни с
  // повторным визитом того же человека.
  it("не даёт завести клиента по хвосту номера или по имени", () => {
    expect(isCreatableClientPhone("4242")).toBe(false);
    expect(isCreatableClientPhone("7795928")).toBe(false);
    expect(isCreatableClientPhone("Иван")).toBe(false);
    expect(isCreatableClientPhone("")).toBe(false);
  });

  it("пропускает полный номер в любой записи", () => {
    expect(isCreatableClientPhone("77795928")).toBe(true);
    expect(isCreatableClientPhone("+373 777 95 928")).toBe(true);
    expect(isCreatableClientPhone("079 42 42 42")).toBe(true);
  });
});

describe("normalizePhone", () => {
  it("оставляет только цифры", () => {
    expect(normalizePhone("+7 999 123-45-67")).toBe("79991234567");
    expect(normalizePhone("(079) 42-42-42")).toBe("079424242");
  });
});
