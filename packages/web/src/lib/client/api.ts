import { UserFacingError } from "./errors";

const FAILED = "Algo falló. Probá de nuevo.";

/** The route's answer; a failure throws with the message the route wrote for people (see `userMessage`). */
async function answer<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) throw new UserFacingError(typeof data.error === "string" && data.error ? data.error : FAILED);
  return data as T;
}

/** POSTs JSON to one of our routes. */
export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  return answer<T>(
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

export async function get<T>(path: string): Promise<T> {
  return answer<T>(await fetch(path));
}
