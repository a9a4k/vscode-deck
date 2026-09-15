import { buildFaviconIcons } from './buildFaviconIcons';
import type { CachedFavicon, CachedFaviconIcon, FaviconCache } from './faviconCache';
import { FAVICON_ALGORITHM_VERSION } from './faviconSilhouette';

export type FetchFavicon = (hostname: string) => Promise<Uint8Array | undefined>;

export const FAVICON_NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export interface FaviconProviderOptions {
  now?: () => number;
  negativeCacheTtlMs?: number;
}

export class FaviconProvider {
  private readonly inFlightListeners = new Map<string, Set<() => void>>();
  private readonly now: () => number;
  private readonly negativeCacheTtlMs: number;

  constructor(
    private readonly cache: Pick<FaviconCache, 'get' | 'set'>,
    private readonly fetchFavicon: FetchFavicon,
    options: FaviconProviderOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.negativeCacheTtlMs = options.negativeCacheTtlMs ?? FAVICON_NEGATIVE_CACHE_TTL_MS;
  }

  getCachedIcon(hostname: string): CachedFaviconIcon | undefined {
    const cached = this.cache.get(hostname);
    if (typeof cached !== 'object' || 'none' in cached) return undefined;
    if (cached.algoVersion !== FAVICON_ALGORITHM_VERSION) return undefined;
    return cached;
  }

  ensureFetched(hostname: string, onSettled: () => void): void {
    if (!this.needsRefresh(hostname)) return;
    const listeners = this.inFlightListeners.get(hostname);
    if (listeners !== undefined) {
      listeners.add(onSettled);
      return;
    }
    this.inFlightListeners.set(hostname, new Set([onSettled]));
    void this.fetchAndCache(hostname);
  }

  private async fetchAndCache(hostname: string): Promise<void> {
    try {
      const bytes = await this.fetchFavicon(hostname).catch(() => undefined);
      const icons = bytes === undefined ? undefined : buildFaviconIcons(bytes);
      let cached: CachedFavicon;
      if (icons === undefined) {
        cached = { none: true, checkedAt: this.now() };
      } else {
        cached = {
          light: toPngDataUri(icons.light),
          dark: toPngDataUri(icons.dark),
          algoVersion: FAVICON_ALGORITHM_VERSION,
        };
      }
      await this.cache.set(hostname, cached);
    } finally {
      const listeners = this.inFlightListeners.get(hostname) ?? [];
      this.inFlightListeners.delete(hostname);
      for (const listener of listeners) listener();
    }
  }

  private needsRefresh(hostname: string): boolean {
    const cached = this.cache.get(hostname);
    if (cached === undefined || cached === 'none') return true;
    if ('none' in cached) return this.now() - cached.checkedAt >= this.negativeCacheTtlMs;
    return cached.algoVersion !== FAVICON_ALGORITHM_VERSION;
  }
}

function toPngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}
