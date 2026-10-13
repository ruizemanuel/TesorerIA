import { describe, expect, it } from "vitest";
import { hrefPanel, isPlainClick, namesPanel, panelKey, readPanel, samePage } from "../src/lib/panel";

const search = (query: string) => new URLSearchParams(query);

describe("readPanel: which panel the URL opens (spec, 9.2)", () => {
  it("reads Aportar, Cargar gasto, Tu cuenta and Agente from `p`", () => {
    expect(readPanel(search("p=aportar"))).toEqual({ kind: "aportar" });
    expect(readPanel(search("p=gasto"))).toEqual({ kind: "gasto" });
    expect(readPanel(search("p=cuenta"))).toEqual({ kind: "cuenta" });
    expect(readPanel(search("p=agente"))).toEqual({ kind: "agente" });
  });

  it("reads a comprobante with its item's id, and none without one", () => {
    expect(readPanel(search("p=comprobante&id=0xabc-3"))).toEqual({ kind: "comprobante", id: "0xabc-3" });
    expect(readPanel(search("p=comprobante"))).toBeNull();
    expect(readPanel(search("p=comprobante&id="))).toBeNull();
  });

  it("opens nothing without `p`, or with one it doesn't know", () => {
    expect(readPanel(search(""))).toBeNull();
    expect(readPanel(search("aporte=1000"))).toBeNull();
    expect(readPanel(search("p=chat"))).toBeNull();
  });
});

describe("panelKey: what a panel shows, as one string", () => {
  it("is the kind of a fixed panel, and the item's id with a comprobante", () => {
    expect(panelKey({ kind: "agente" })).toBe("agente");
    expect(panelKey({ kind: "aportar" })).toBe("aportar");
    expect(panelKey({ kind: "comprobante", id: "0xabc-3" })).toBe("comprobante:0xabc-3");
  });

  it("tells two comprobantes apart, so going from one to the other opens a fresh dialog", () => {
    expect(panelKey({ kind: "comprobante", id: "0xabc-3" })).not.toBe(panelKey({ kind: "comprobante", id: "0xabc-4" }));
  });
});

describe("namesPanel: whether the URL asks for a panel to be open", () => {
  it("is true while the URL names that very panel", () => {
    expect(namesPanel(search("p=agente"), "agente")).toBe(true);
    expect(namesPanel(search("p=comprobante&id=0xabc-3"), "comprobante:0xabc-3")).toBe(true);
  });

  it("is false once the panel was closed (no `p`), and for another panel or another comprobante", () => {
    expect(namesPanel(search(""), "agente")).toBe(false);
    expect(namesPanel(search("aporte=1000"), "agente")).toBe(false);
    expect(namesPanel(search("p=gasto"), "agente")).toBe(false);
    expect(namesPanel(search("p=comprobante&id=0xabc-4"), "comprobante:0xabc-3")).toBe(false);
    expect(namesPanel(search("p=comprobante"), "comprobante:")).toBe(false);
  });
});

describe("hrefPanel: the panel a link opens, read from where the page is", () => {
  const here = "http://localhost:3000/f/0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD";

  it("reads a query-only link and a full one alike", () => {
    expect(hrefPanel("?p=gasto", here)).toBe("gasto");
    expect(hrefPanel("/f/0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD?p=agente", `${here}?p=agente`)).toBe("agente");
    expect(hrefPanel("?p=comprobante&id=0xabc-3", here)).toBe("comprobante:0xabc-3");
  });

  it("is null for a link that opens no panel", () => {
    expect(hrefPanel("/f/0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD/movimientos", here)).toBeNull();
    expect(hrefPanel("?p=comprobante", here)).toBeNull();
  });
});

describe("samePage: whether a link stays on the page it's on", () => {
  const inicio = "/f/0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD";

  it("is true for a query-only link and for this page's own path with a query", () => {
    expect(samePage("?p=aportar", inicio)).toBe(true);
    expect(samePage(`${inicio}?p=cuenta`, inicio)).toBe(true);
  });

  it("is false for another page, even of the same fund", () => {
    expect(samePage(`${inicio}?p=cuenta`, `${inicio}/movimientos`)).toBe(false);
    expect(samePage(`${inicio}/movimientos`, inicio)).toBe(false);
    expect(samePage("/", inicio)).toBe(false);
  });

  it("is false for the same path on another site: the History API only changes this one's URL", () => {
    expect(samePage(`https://example.com${inicio}?p=aportar`, inicio)).toBe(false);
    expect(samePage(`//example.com${inicio}?p=aportar`, inicio)).toBe(false);
  });
});

describe("isPlainClick: a click the page may handle itself", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

  it("is true for a plain left click", () => {
    expect(isPlainClick(click)).toBe(true);
  });

  it("leaves the browser's own behavior to a modifier key, another button, or a click already handled", () => {
    for (const change of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      expect(isPlainClick({ ...click, ...change })).toBe(false);
    }
  });
});
