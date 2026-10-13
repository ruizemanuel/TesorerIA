/** The panels a fund's screen opens over itself (spec, 9.2), each one its own `?p=`. */
export type PanelState =
  | { kind: "aportar" }
  | { kind: "gasto" }
  | { kind: "cuenta" }
  | { kind: "agente" }
  | { kind: "comprobante"; id: string };

/** Which panel the URL opens: none without `p`, with one this screen doesn't know, or with a comprobante and no id. */
export function readPanel(search: { get(name: string): string | null }): PanelState | null {
  switch (search.get("p")) {
    case "aportar":
      return { kind: "aportar" };
    case "gasto":
      return { kind: "gasto" };
    case "cuenta":
      return { kind: "cuenta" };
    case "agente":
      return { kind: "agente" };
    case "comprobante": {
      const id = search.get("id");
      return id ? { kind: "comprobante", id } : null;
    }
    default:
      return null;
  }
}

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
