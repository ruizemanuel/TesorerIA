/**
 * A name as it's compared to find two people who go by the same one: trimmed, with any run of whitespace as a single
 * space, lower case, and without accents (or the marks and compatibility forms that NFKD splits off, such as a
 * full-width letter) nor invisible format characters (a zero-width space or joiner, a soft hyphen, a byte order mark).
 * "Lucas", " lucás ", "LUCAS" and "Luc<zero-width space>as" have the same key. Empty for a blank name.
 */
function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Whether two names are the same one by nameKey. A blank name is nobody's: it matches nothing, not even another blank one. */
export function sameName(a: string, b: string): boolean {
  const key = nameKey(a);
  return key !== "" && key === nameKey(b);
}
