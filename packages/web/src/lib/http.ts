import type { z } from "zod";

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * The request's JSON body, checked against `schema`. Only `application/json` is read, so a form posted from
 * another site (which can't send that type without CORS) never reaches a route: with the lax cookie, that is
 * the CSRF defense.
 */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, response: jsonError(415, "Expected application/json") };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, "Algo falló. Probá de nuevo.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: jsonError(400, "Faltan datos o no son válidos.") };
  return { ok: true, value: parsed.data };
}
