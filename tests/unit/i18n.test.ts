import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import {locales, isLocale, direction} from "../../src/i18n/locales";

describe("public localization", () => {
  it("ten_locale_key_parity", () => {
    const dictionaries = locales.map(locale => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<string,string>);
    const keys = Object.keys(dictionaries[0]).sort();
    expect(locales).toHaveLength(10);
    for (const dictionary of dictionaries) {
      expect(Object.keys(dictionary).sort()).toEqual(keys);
      for (const value of Object.values(dictionary)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });
  it("Arabic is RTL and Dutch/Ukrainian use canonical locale codes", () => {
    expect(direction("ar")).toBe("rtl");
    expect(direction("de")).toBe("ltr");
    expect(isLocale("nl")).toBe(true);
    expect(isLocale("uk")).toBe(true);
    expect(isLocale("ua")).toBe(false);
  });
  it("approval and payment notices are translated rather than English fallbacks", () => {
    const english = JSON.parse(readFileSync("messages/en.json", "utf8"));
    for (const locale of locales.filter(value => value !== "en")) {
      const dictionary = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      for (const key of ["pendingNotice", "approvalNotice", "termsConsent", "noPayment", "quoteNotice"]) {
        expect(dictionary[key]).not.toBe(english[key]);
      }
    }
  });
});
