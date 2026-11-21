import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateFundForm } from "../src/components/create-fund-form";
import type { CountryCode } from "../src/lib/countries";
import { LocaleProvider } from "../src/lib/i18n/client";
import type { Locale } from "../src/lib/i18n/locales";

// The form goes to the draft through the app router, which isn't mounted when a test renders on its own.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/crear",
  useSearchParams: () => new URLSearchParams(),
}));

/** /crear's form as the page renders it: inside a LocaleProvider with the country chosen. */
function render(country: CountryCode, offered: readonly CountryCode[], locale: Locale = "es") {
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale, country, children: createElement(CreateFundForm, { loggedIn: true, country, offered }) }),
  );
}

describe("CreateFundForm (spec, 9)", () => {
  it("doesn't ask where the group is from with one country offered, as in production today", () => {
    const html = render("AR", ["AR"]);
    expect(html).not.toContain("¿De dónde es el grupo?");
    expect(html).not.toContain("/crear?country=");
    // Argentina's defaults, as the form always started.
    expect(html).toContain('value="10.000"');
    expect(html).toContain('value="60.000"');
  });

  it("links each offered country, the chosen one marked, with that country's defaults", () => {
    const html = render("MX", ["AR", "MX"]);
    expect(html).toContain("¿De dónde es el grupo?");
    expect(html).toMatch(/<a href="\/crear\?country=AR"[^>]*>Argentina<\/a>/);
    expect(html).toMatch(/<a href="\/crear\?country=MX" aria-current="page"[^>]*>México<\/a>/);
    expect(html).not.toMatch(/country=AR" aria-current/);
    expect(html).toContain('value="100"');
    expect(html).toContain('value="600"');
    expect(render("AR", ["AR", "MX"], "en")).toContain("Where is the group from?");
  });
});
