import { UserFacingError } from "./errors";

/** The route's answer; a failure throws with the message the route wrote for people, or the `failed` key when it said none (see `userMessage`). */
async function answer<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) throw new UserFacingError(typeof data.error === "string" && data.error ? data.error : { key: "failed" });
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

/** DELETEs one of our routes' resources. */
export async function del<T = unknown>(path: string): Promise<T> {
  return answer<T>(await fetch(path, { method: "DELETE" }));
}

export async function get<T>(path: string): Promise<T> {
  return answer<T>(await fetch(path));
}
