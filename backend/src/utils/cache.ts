import { logger } from './logger';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private pendingPromises: Map<string, Promise<any>> = new Map();

  /**
   * Generates a standardized cache key
   */
  generateKey(provider: string, params: Record<string, string | number>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return `${provider}:${sortedParams}`;
  }

  /**
   * Retrieves data from the cache if it exists and is not expired.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Stores data in the cache with a specified TTL (Time To Live) in seconds.
   */
  set<T>(key: string, data: T, ttlSeconds: number = 3600): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Fetches data with deduplication and caching.
   * If a request for the same key is already in flight, it returns the shared Promise.
   * If the data is cached, it returns the cached data immediately.
   */
  async fetchOrCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 3600,
    context?: { provider: string }
  ): Promise<T> {
    const startTime = Date.now();
    const provider = context?.provider || 'Unknown';

    // 1. Check cache
    const cachedData = this.get<T>(key);
    if (cachedData) {
      logger.info(`[Cache] HIT: ${key}`, {
        provider,
        latencyMs: Date.now() - startTime,
        cacheStatus: 'HIT',
      });
      return cachedData;
    }

    // 2. Check pending promises (Deduplication)
    if (this.pendingPromises.has(key)) {
      logger.info(`[Cache] SHARED PROMISE: ${key}`, {
        provider,
        latencyMs: Date.now() - startTime,
        cacheStatus: 'SHARED',
      });
      return this.pendingPromises.get(key) as Promise<T>;
    }

    // 3. Execute fetcher
    const fetchPromise = (async () => {
      try {
        const data = await fetcher();
        this.set(key, data, ttlSeconds);
        logger.info(`[Cache] SET: ${key}`, {
          provider,
          latencyMs: Date.now() - startTime,
          cacheStatus: 'MISS',
        });
        return data;
      } catch (error) {
        logger.error(`[Cache] FETCH ERROR: ${key}`, {
          provider,
          latencyMs: Date.now() - startTime,
          cacheStatus: 'MISS',
          error: error instanceof Error ? error.message : error,
        });
        throw error;
      } finally {
        this.pendingPromises.delete(key);
      }
    })();

    this.pendingPromises.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Clears the entire cache or a specific key.
   */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

export const sharedCache = new CacheManager();
