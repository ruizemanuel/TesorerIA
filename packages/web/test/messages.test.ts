import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { LOCALES, LOCALE_NAMES } from "../src/lib/i18n/locales";
import { MESSAGES, messagesFor } from "../src/lib/i18n/messages";

/** Every path to a leaf of a dictionary, so a missing or extra sentence shows by name. */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => paths(inner, prefix === "" ? key : `${prefix}.${key}`));
}

describe("the dictionaries", () => {
  it("give each language its own", () => {
    expect(messagesFor("es")).toBe(es);
    expect(messagesFor("en")).toBe(en);
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
  });

  it("have the same sentences in both languages, and each the same kind of thing", () => {
    // TypeScript checks this already; this catches a cast that hides a gap from it.
    expect(paths(en).sort()).toEqual(paths(es).sort());
    for (const path of paths(es)) {
      const kind = (dictionary: unknown) => typeof path.split(".").reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], dictionary);
      expect(kind(en), path).toBe(kind(es));
    }
  });

  it("say the page's description in each language", () => {
    expect(es.meta.description).toBe("La plata del grupo, sin tesorero.");
    expect(en.meta.description).toBe("The group's treasury, without a treasurer.");
  });

  it("name each language in itself, for the switch", () => {
    expect(LOCALE_NAMES).toEqual({ es: "Español", en: "English" });
  });
});
