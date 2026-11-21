import { USDT } from "@tesoreria/agent";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { ContributePanel } from "../src/components/contribute-panel";
import { COUNTRIES, type CountryCode } from "../src/lib/countries";
import { LocaleProvider } from "../src/lib/i18n/client";
import { messagesFor } from "../src/lib/i18n/messages";

// The panel asks Next's router for its refresh; nothing here navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const ME = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const UNIT = 10n ** 18n;

/** Aportar, as its first render shows it, for a fund of `country` that takes `dollar` (or none). */
function render(country: CountryCode, dollar: typeof USDT | null) {
  const panel = createElement(ContributePanel, {
    fund: FUND,
    version: 2,
    account: ME,
    currency: COUNTRIES[country].currency.token,
    dollar,
    feeBps: 25,
    balance: 0n,
    counted: 0n,
    balanceCap: 450_000n * UNIT,
    owed: 0n,
    weeklyFee: 10_000n * UNIT,
    contributionOnItsWay: false,
  });
  return renderToStaticMarkup(createElement(LocaleProvider, { locale: "es", country, children: panel }));
}

describe("Aportar's tabs", () => {
  it("shows both ways to send when the fund has a dollar: USDT, and pesos from Ripio", () => {
    const m = messagesFor("es", "AR");
    const html = render("AR", USDT);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain(m.contribute.haveUsdt);
    expect(html).toContain(m.contribute.havePesos);
  });

  it("shows one form with no tabs when the fund has no dollar: a tab for Ripio's pesos would say the member has an account there", () => {
    const m = messagesFor("es", "MX");
    const html = render("MX", null);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).not.toContain(m.contribute.haveUsdt);
    expect(html).not.toContain(m.contribute.havePesos);
    expect(html).toContain(m.contribute.rampOnly("wMXN"));
    expect(html).toContain("ramp.ripio.com/?country=MX&amp;chain=42220&amp;token=WMXN");
  });
});
