import { describe, expect, it } from "vitest";
import { isPlainClick, readPanel, samePage } from "../src/lib/panel";

const search = (query: string) => new URLSearchParams(query);

describe("readPanel: which panel the URL opens (spec, 9.2)", () => {
  it("reads Aportar, Cargar gasto and Tu cuenta from `p`", () => {
    expect(readPanel(search("p=aportar"))).toEqual({ kind: "aportar" });
    expect(readPanel(search("p=gasto"))).toEqual({ kind: "gasto" });
    expect(readPanel(search("p=cuenta"))).toEqual({ kind: "cuenta" });
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
