/**
 * A name as it's compared to find two people who go by the same one: trimmed, with any run of whitespace as a single
 * space, lower case, and without accents (or the marks and compatibility forms that NFKD splits off, such as a
 * full-width letter). "Lucas", " lucás " and "LUCAS" have the same key. Empty for a blank name.
 */
function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Whether two names are the same one by nameKey. A blank name is nobody's: it matches nothing, not even another blank one. */
export function sameName(a: string, b: string): boolean {
  const key = nameKey(a);
  return key !== "" && key === nameKey(b);
}
