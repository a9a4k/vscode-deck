import type { MementoLike } from '../switch/activeWorktreeStore';

export const FAVICON_CACHE_KEY = 'deck.favicons';

export interface CachedFaviconIcon {
  light: string;
  dark: string;
  algoVersion?: number;
}

export interface CachedMissingFavicon {
  none: true;
  checkedAt: number;
}

export type CachedFavicon = CachedFaviconIcon | CachedMissingFavicon | 'none';

export class FaviconCache {
  constructor(private readonly memento: MementoLike) {}

  get(hostname: string): CachedFavicon | undefined {
    return this.all()[hostname];
  }

  async set(hostname: string, favicon: CachedFavicon): Promise<void> {
    await this.memento.update(FAVICON_CACHE_KEY, {
      ...this.all(),
      [hostname]: favicon,
    });
  }

  private all(): Record<string, CachedFavicon> {
    return this.memento.get<Record<string, CachedFavicon>>(FAVICON_CACHE_KEY, {});
  }
}
