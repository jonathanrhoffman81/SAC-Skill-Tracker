type CacheEntry<T> = {
  value: T;
  updatedAt: number;
  revalidatingPromise?: Promise<void>;
};

const routeCache = new Map<string, CacheEntry<unknown>>();
const MAX_CACHE_ENTRIES = 300;

function trimCacheIfNeeded() {
  if (routeCache.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  const entries = Array.from(routeCache.entries()).sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );

  const overflow = routeCache.size - MAX_CACHE_ENTRIES;
  for (let index = 0; index < overflow; index += 1) {
    routeCache.delete(entries[index][0]);
  }
}

function setCacheEntry<T>(key: string, value: T): CacheEntry<T> {
  const entry: CacheEntry<T> = {
    value,
    updatedAt: Date.now(),
  };
  routeCache.set(key, entry);
  trimCacheIfNeeded();
  return entry;
}

export async function getCachedOrRevalidate<T>(options: {
  key: string;
  maxAgeMs: number;
  staleWhileRevalidateMs: number;
  loader: () => Promise<T>;
}): Promise<{ value: T; cacheStatus: "miss" | "fresh" | "stale" }> {
  const { key, maxAgeMs, staleWhileRevalidateMs, loader } = options;
  const existing = routeCache.get(key) as CacheEntry<T> | undefined;

  if (!existing) {
    const loadedValue = await loader();
    setCacheEntry(key, loadedValue);
    return { value: loadedValue, cacheStatus: "miss" };
  }

  const ageMs = Date.now() - existing.updatedAt;
  if (ageMs <= maxAgeMs) {
    return { value: existing.value, cacheStatus: "fresh" };
  }

  if (ageMs <= maxAgeMs + staleWhileRevalidateMs) {
    if (!existing.revalidatingPromise) {
      existing.revalidatingPromise = (async () => {
        try {
          const refreshed = await loader();
          setCacheEntry(key, refreshed);
        } catch (error) {
          console.warn("Background revalidation failed for", key, error);
        } finally {
          const latest = routeCache.get(key) as CacheEntry<T> | undefined;
          if (latest) {
            delete latest.revalidatingPromise;
            routeCache.set(key, latest);
          }
        }
      })();
      routeCache.set(key, existing);
    }

    return { value: existing.value, cacheStatus: "stale" };
  }

  const loadedValue = await loader();
  setCacheEntry(key, loadedValue);
  return { value: loadedValue, cacheStatus: "miss" };
}

export function invalidateRouteCache(keyPrefix: string) {
  for (const key of routeCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      routeCache.delete(key);
    }
  }
}
