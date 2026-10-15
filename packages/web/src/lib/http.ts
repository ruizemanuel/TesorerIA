import type { z } from "zod";
import { localeOf } from "./i18n/locales";
import { messagesFor } from "./i18n/messages";

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * The request's JSON body, checked against `schema`. Only `application/json` is read, so a form posted from
 * another site (which can't send that type without CORS) never reaches a route: with the lax cookie, that is
 * the CSRF defense.
 *
 * With `maxBytes`, a body above it is refused with 413, whether it says so in its content-length or not (a chunked
 * body has none, and a header can lie): the declared length is checked first, then the text actually read.
 *
 * It answers in the request's language (`localeOf`); only the 415, which no person ever sees, stays in technical English.
 */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  { maxBytes }: { maxBytes?: number } = {},
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const m = messagesFor(localeOf(request));
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, response: jsonError(415, "Expected application/json") };
  }
  const tooBig = () => ({ ok: false, response: jsonError(413, m.errors.badRequest) }) as const;
  if (maxBytes !== undefined && Number(request.headers.get("content-length") ?? "0") > maxBytes) return tooBig();
  let body: unknown;
  try {
    if (maxBytes === undefined) {
      body = await request.json();
    } else {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > maxBytes) return tooBig();
      body = JSON.parse(text);
    }
  } catch {
    return { ok: false, response: jsonError(400, m.errors.failed) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: jsonError(400, m.errors.badRequest) };
  return { ok: true, value: parsed.data };
}
