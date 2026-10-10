type Entry<T> = { at: number; promise: Promise<T | null> };

/** About as many keys as one memo keeps: the oldest goes first. */
const MAX_KEYS = 32;

// One map per memo name, per process: route handlers and pages may load this module more than once in development.
const shared = globalThis as { tesoreriaMemos?: Map<string, Map<string, Entry<unknown>>> };

/**
 * `load`, remembered per key for `ttlMs`: within that time every call (concurrent ones included) gets the same
 * promise, so many hits share one read. A load that fails or finds nothing (null) is never kept, so the next call
 * reads again. The entries live on `globalThis` under `name`; `now` is the clock, for tests.
 */
export function ttlMemo<T>(
  name: string,
  ttlMs: number,
  load: (key: string) => Promise<T | null>,
  now: () => number = Date.now,
): (key: string) => Promise<T | null> {
  const memos = (shared.tesoreriaMemos ??= new Map());
  if (!memos.has(name)) memos.set(name, new Map());
  const entries = memos.get(name) as Map<string, Entry<T>>;

  return (key) => {
    const at = now();
    const kept = entries.get(key);
    if (kept !== undefined && at - kept.at < ttlMs) return kept.promise;

    entries.delete(key); // set again below, so the map's order is the order of the reads
    if (entries.size >= MAX_KEYS) entries.delete(entries.keys().next().value!);
    const entry: Entry<T> = { at, promise: load(key) };
    entries.set(key, entry);
    const forget = () => {
      if (entries.get(key) === entry) entries.delete(key);
    };
    entry.promise.then((value) => {
      if (value === null) forget();
    }, forget);
    return entry.promise;
  };
}
