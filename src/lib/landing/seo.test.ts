import { describe, expect, it } from "vitest";
import { LandingJsonLd } from "@/components/landing/json-ld";
import type { LandingRenderData } from "@/lib/landing/get-render-data";
import { landingDescription } from "@/lib/landing/description";
import { plainTextToDoc } from "@/lib/rich-text";

// Данные повторяют боевые лендинги на 2026-09-18: КидсБург и Керен Центр —
// Тирасполь, пояс Europe/Chisinau, валюта RUB (приднестровского рубля в
// справочнике нет).
function landing(overrides: {
  name?: string;
  timezone?: string;
  currency?: string | null;
  showPrices?: boolean;
  pointName?: string;
  address?: string | null;
  city?: string | null;
  prices?: number[];
}): LandingRenderData {
  const pointId = "p1";
  return {
    tenant: {
      name: overrides.name ?? "КидсБург",
      locale: "ru",
      accentScheme: "blue",
      logoUrl: null,
      timezone: overrides.timezone ?? "Europe/Chisinau",
      currency: overrides.currency === undefined ? "RUB" : overrides.currency,
    },
    slug: "kidsburg",
    status: "published",
    theme: "pixel",
    effect: "none",
    tagline: "Аттракционы в Тирасполе",
    aboutText: plainTextToDoc("Лучшие электромобили в Приднестровье."),
    galleryEnabled: false,
    ourFleetEnabled: false,
    showPrices: overrides.showPrices ?? true,
    videoEnabled: false,
    videoYoutubeId: null,
    videoPoster: null,
    contacts: {
      phone: null,
      telegram: null,
      viber: null,
      whatsapp: null,
      instagram: null,
      facebook: null,
      tiktok: null,
      vk: null,
      ok: null,
      youtube: null,
    },
    websiteUrl: null,
    metaTitleOverride: null,
    metaDescriptionOverride: null,
    googleSiteVerification: null,
    telegramGroupUrl: null,
    updatedAt: new Date("2026-07-28T16:03:47Z"),
    rulesInstruction: null,
    galleryPhotos: [],
    zones: (overrides.prices ?? [35, 50]).map((price, i) => ({
      id: `z${i}`,
      name: `Зона ${i}`,
      iconKey: null,
      photoUrl: null,
      caption: null,
      tariffs: [{ id: `t${i}`, name: "Тариф", price, optionPrices: [] }],
      assetsCount: 0,
      fleetAssets: [],
      fleetOverflowCount: 0,
      pointId,
      pointName: overrides.pointName ?? "Парк Екатерининский",
      pointCity: overrides.city === undefined ? "Тирасполь" : overrides.city,
      pointIconKey: null,
    })),
    points: [
      {
        id: pointId,
        name: overrides.pointName ?? "Парк Екатерининский",
        address: overrides.address === undefined ? "Центр города" : overrides.address,
        city: overrides.city === undefined ? "Тирасполь" : overrides.city,
        latitude: null,
        longitude: null,
        hoursNote: null,
        mapsUrl: null,
        openingHours: [],
        zoneNames: [],
        hasLocationInfo: true,
        openStatus: null,
      },
    ],
    primaryCity: "Тирасполь",
  };
}

function business(data: LandingRenderData) {
  const element = LandingJsonLd({ data, baseUrl: "https://my.rentos365.app" });
  const graph = JSON.parse(element.props.dangerouslySetInnerHTML.__html)["@graph"] as Record<string, unknown>[];
  return graph.find((node) => node["@type"] === "EntertainmentBusiness")!;
}

describe("JSON-LD лендинга", () => {
  it("Приднестровье: RUB уходит в разметку как MDL, страна MD", () => {
    const node = business(landing({}));
    expect(node.priceRange).toBe("35–50 MDL");
    expect(node.address).toMatchObject({ streetAddress: "Центр города", addressLocality: "Тирасполь", addressCountry: "MD" });
  });

  it("Россия: RUB остаётся RUB", () => {
    const node = business(landing({ timezone: "Europe/Moscow" }));
    expect(node.priceRange).toBe("35–50 RUB");
    expect(node.address).toMatchObject({ addressCountry: "RU" });
  });

  it("пояс не выставлен — ни страны, ни подмены валюты", () => {
    const node = business(landing({ timezone: "UTC" }));
    expect(node.priceRange).toBe("35–50 RUB");
    expect((node.address as Record<string, unknown>).addressCountry).toBeUndefined();
  });

  it("цены скрыты владельцем — priceRange нет", () => {
    expect(business(landing({ showPrices: false })).priceRange).toBeUndefined();
  });

  it("валюта не задана — priceRange нет", () => {
    expect(business(landing({ currency: null })).priceRange).toBeUndefined();
  });

  it("одна цена — без диапазона; нулевые тарифы-заглушки не в счёт", () => {
    expect(business(landing({ prices: [0, 35] })).priceRange).toBe("35 MDL");
  });

  it("все цены нулевые — priceRange нет (и нет -Infinity)", () => {
    expect(business(landing({ prices: [0] })).priceRange).toBeUndefined();
  });

  it("точка названа как компания — название не повторяется", () => {
    expect(business(landing({ name: "Керен Центр", pointName: "Керен Центр" })).name).toBe("Керен Центр");
    expect(business(landing({})).name).toBe("КидсБург — Парк Екатерининский");
  });

  it("без улицы адрес всё равно есть: город и страна", () => {
    expect(business(landing({ address: null })).address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Тирасполь",
      addressCountry: "MD",
    });
  });
});

describe("landingDescription", () => {
  const keren =
    "Керен Центр в Тирасполе — пространство для детей и семьи: игровая комната «Халабуда», продлёнка, мастер-классы, квесты, дни рождения и уютные праздники. Играем, учимся и дружим каждый день.";

  const describeText = (text: string) =>
    landingDescription({ metaDescriptionOverride: null, aboutText: plainTextToDoc(text) });

  it("режет по концу предложения, а не посреди текста (Керен Центр)", () => {
    expect(describeText(keren)).toBe(
      "Керен Центр в Тирасполе — пространство для детей и семьи: игровая комната «Халабуда», продлёнка, мастер-классы, квесты, дни рождения и уютные праздники."
    );
  });

  it("длинное предложение — по целому слову с многоточием, в пределах 160", () => {
    const text = "слово ".repeat(40).trim();
    const result = describeText(text);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("слово…")).toBe(true);
  });

  it("короткий текст не трогает", () => {
    expect(describeText("Лучшие электромобили в Приднестровье.")).toBe("Лучшие электромобили в Приднестровье.");
  });
});
