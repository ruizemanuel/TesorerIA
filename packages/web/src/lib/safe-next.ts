const BASE = "https://x.invalid";

/**
 * Where to send a person after logging in: a path on this site, or "/". `next` comes from the address bar, so
 * it is parsed the way the browser will read it (WHATWG URL): that is what turns "/\evil.example" and
 * "/<tab>/evil.example" into https://evil.example, which a plain `startsWith("//")` check lets through.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return "/";
    const path = url.pathname + url.search + url.hash;
    // "/.//evil.example" normalizes to the path "//evil.example", which a redirect reads as another site.
    return path.startsWith("//") ? "/" : path;
  } catch {
    return "/";
  }
}
