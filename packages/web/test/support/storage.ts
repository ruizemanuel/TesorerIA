import { vi } from "vitest";

/** The key the browser remembers the last passkey site under (passkey.ts). */
export const SITE_KEY = "tesoreria.passkey-site";

/** `localStorage` as a map, or a storage that throws (a private window, blocked site data). Unstubbed by `vi.unstubAllGlobals()`. */
export function stubLocalStorage(initial: Record<string, string> = {}, broken = false) {
  const items = new Map(Object.entries(initial));
  const fail = () => {
    if (broken) throw new DOMException("blocked", "SecurityError");
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (fail(), items.get(key) ?? null),
    setItem: (key: string, value: string) => (fail(), void items.set(key, value)),
  });
  return items;
}
