import { timingSafeEqual } from "node:crypto";

/** Whether the request carries `Bearer <secret>`, compared in constant time. With no secret set, nothing passes. */
export function isHeartbeatAuthorized(header: string | null, secret: string | undefined): boolean {
  if (secret === undefined || secret.length === 0 || header === null) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
