/** The panels a fund's screen opens over itself (spec, 9.2), each one its own `?p=`. */
export type PanelState =
  | { kind: "aportar" }
  | { kind: "gasto" }
  | { kind: "cuenta" }
  | { kind: "pesos" }
  | { kind: "agente" }
  | { kind: "comprobante"; id: string }
  /** A week's summary (spec, 9.4): `week` is the contract's, from 0; the URL says it as people count it, from 1. */
  | { kind: "resumen"; week: number };

/** Which panel the URL opens: none without `p`, with one this screen doesn't know, or one that lacks what it names (a comprobante's id, a summary's week). */
export function readPanel(search: { get(name: string): string | null }): PanelState | null {
  switch (search.get("p")) {
    case "aportar":
      return { kind: "aportar" };
    case "gasto":
      return { kind: "gasto" };
    case "cuenta":
      return { kind: "cuenta" };
    case "pesos":
      return { kind: "pesos" };
    case "agente":
      return { kind: "agente" };
    case "comprobante": {
      const id = search.get("id");
      return id ? { kind: "comprobante", id } : null;
    }
    case "resumen": {
      const week = search.get("semana");
      return week !== null && /^[1-9]\d{0,4}$/.test(week) ? { kind: "resumen", week: Number(week) - 1 } : null;
    }
    default:
      return null;
  }
}

/** What a panel shows, as one string: its kind, or a comprobante with its item's id, or a summary with its week, so two of them differ. */
export function panelKey(state: PanelState): string {
  if (state.kind === "comprobante") return `comprobante:${state.id}`;
  if (state.kind === "resumen") return `resumen:${state.week}`;
  return state.kind;
}

/** Whether the URL (its query) asks for the panel `key` (panelKey) to be open. */
export function namesPanel(search: { get(name: string): string | null }, key: string): boolean {
  const state = readPanel(search);
  return state !== null && panelKey(state) === key;
}

/** The panel a link to `href` opens (its panelKey), read against the page's URL `current`, or null if it opens none. */
export function hrefPanel(href: string, current: string): string | null {
  const state = readPanel(new URL(href, current).searchParams);
  return state === null ? null : panelKey(state);
}

/** What a PanelLink sends a Panel (its panelKey as the detail) to open it again with the URL as it is. */
export const REOPEN_PANEL = "tesoreria:reopen-panel";

/** Whether `href`, read from `pathname`, stays on that page: a query-only link, or this page's own path. */
export function samePage(href: string, pathname: string): boolean {
  // A stand-in origin: a link that resolves to any other one leaves the site.
  const origin = "http://page";
  const url = new URL(href, `${origin}${pathname}`);
  return url.origin === origin && url.pathname === pathname;
}

type Click = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** A plain left click: one with a modifier key or another button opens a tab or a window, and that's the browser's. */
export function isPlainClick(event: Click): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}
