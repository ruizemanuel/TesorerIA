import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContributeAmount } from "../src/components/contribute-amount";
import { es } from "../src/lib/i18n/es";

/** Aportar's amount, as the USDT tab shows it, with these changes. */
function render(changes: { token?: "usdt" | "wars"; problem?: string; note?: string } = {}) {
  return renderToStaticMarkup(
    createElement(ContributeAmount, {
      label: es.contribute.amountLabel,
      held: es.contribute.youHold("6,18 USDT"),
      token: "usdt",
      value: "6,18",
      problem: "",
      note: es.contribute.covers("$ 10.000"),
      disabled: false,
      onChange() {},
      ...changes,
    }),
  );
}

describe("ContributeAmount", () => {
  it("shows the label, what the account holds, the amount with its currency, and what it covers", () => {
    const html = render();
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Cuánto aportás<\/label>/);
    const id = html.match(/<label for="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Tenés 6,18 USDT");
    expect(html).toContain('value="6,18"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain("USDT</span>");
    expect(html).toContain("Cubre los $ 10.000, al precio de ahora.");
    expect(html).not.toContain('role="alert"');
  });

  it("names the currency of the pesos tab", () => {
    expect(render({ token: "wars", note: undefined })).toContain("ARS</span>");
  });

  it("puts what to fix in place of the note, as an alert, and marks the amount as invalid", () => {
    const html = render({ problem: es.contribute.usdtFormat });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Escribilo como 6 o 6,25.");
    expect(html).not.toContain("Cubre los");
    expect(html).toContain('aria-invalid="true"');
  });
});
