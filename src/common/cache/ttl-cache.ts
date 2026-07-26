/**
 * Tiny dependency-free in-process TTL cache for hot, rarely-changing reference reads
 * (countries, currencies, ...). Avoids re-querying the same full collection on every
 * list request.
 *
 * Scope & tradeoffs:
 *  - Per-process (each PM2 worker has its own copy) — fine for read-only reference data.
 *  - TTL-based: a write to the underlying collection is not seen until the entry expires.
 *    Keep TTLs short enough that the staleness window is acceptable (default 5 min).
 *  - In-flight de-duplication: concurrent callers for the same key share one loader call.
 */
interface Entry {
  value: unknown;
  expires: number;
  inflight?: Promise<unknown>;
}

const store = new Map<string, Entry>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  // Coalesce concurrent misses so we only run the loader once.
  if (hit?.inflight) return hit.inflight as Promise<T>;

  const inflight = loader()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      store.delete(key); // don't cache failures
      throw err;
    });

  store.set(key, { value: hit?.value, expires: hit?.expires ?? 0, inflight });
  return inflight as Promise<T>;
}

/** Drop a single cache entry (call after a known write if you need freshness sooner). */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Clear everything (useful in tests). */
export function clearCache(): void {
  store.clear();
}
