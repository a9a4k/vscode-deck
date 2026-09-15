import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FaviconCache } from '../src/bookmark/faviconCache';
import { FaviconProvider } from '../src/bookmark/faviconProvider';
import { FAVICON_ALGORITHM_VERSION } from '../src/bookmark/faviconSilhouette';

const FAVICON_BYTES = readFileSync(join(
  __dirname,
  '../prototypes/bookmark-row-icon-label/spike-composite/github-raw.png',
));

function createCache(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'deck.favicons': initial };
  return new FaviconCache({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });
}

describe('FaviconProvider', () => {
  it('returns immediately without an icon, then publishes the fetched icon', async () => {
    const cache = createCache();
    const fetchFavicon = vi.fn(async () => FAVICON_BYTES);
    const provider = new FaviconProvider(cache, fetchFavicon);
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });

    expect(provider.getCachedIcon('github.com')).toBeUndefined();
    expect(provider.ensureFetched('github.com', finish)).toBeUndefined();
    await settled;

    expect(provider.getCachedIcon('github.com')).toEqual({
      light: expect.stringMatching(/^data:image\/png;base64,/),
      dark: expect.stringMatching(/^data:image\/png;base64,/),
      algoVersion: FAVICON_ALGORITHM_VERSION,
    });
  });

  it('shares one in-flight fetch between every listener for a host', async () => {
    let returnBytes!: (bytes: Uint8Array) => void;
    const fetchFavicon = vi.fn(() => new Promise<Uint8Array>((resolve) => {
      returnBytes = resolve;
    }));
    const provider = new FaviconProvider(createCache(), fetchFavicon);
    const first = vi.fn();
    const second = vi.fn();

    provider.ensureFetched('github.com', first);
    provider.ensureFetched('github.com', second);
    returnBytes(FAVICON_BYTES);
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());

    expect(fetchFavicon).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
  });

  it('reuses a current cached icon without fetching again', () => {
    const cached = {
      light: 'data:image/png;base64,bGlnaHQ=',
      dark: 'data:image/png;base64,ZGFyaw==',
      algoVersion: FAVICON_ALGORITHM_VERSION,
    };
    const fetchFavicon = vi.fn(async () => FAVICON_BYTES);
    const provider = new FaviconProvider(createCache({ 'github.com': cached }), fetchFavicon);
    const settled = vi.fn();

    expect(provider.getCachedIcon('github.com')).toEqual(cached);
    provider.ensureFetched('github.com', settled);

    expect(fetchFavicon).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  });

  it('does not retry a missing favicon before the negative-cache TTL elapses', async () => {
    const cache = createCache();
    const fetchFavicon = vi.fn(async () => undefined);
    const provider = new FaviconProvider(cache, fetchFavicon, { now: () => 1_000 });
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });

    provider.ensureFetched('missing.example', finish);
    await settled;
    provider.ensureFetched('missing.example', vi.fn());

    expect(fetchFavicon).toHaveBeenCalledOnce();
    expect(cache.get('missing.example')).toEqual({ none: true, checkedAt: 1_000 });
  });

  it('retries a missing favicon once the negative-cache TTL elapses', async () => {
    let now = 1_000;
    const fetchFavicon = vi.fn(async () => undefined);
    const provider = new FaviconProvider(createCache({
      'missing.example': { none: true, checkedAt: now },
    }), fetchFavicon, { now: () => now, negativeCacheTtlMs: 100 });

    provider.ensureFetched('missing.example', vi.fn());
    now += 100;
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    provider.ensureFetched('missing.example', finish);
    await settled;

    expect(fetchFavicon).toHaveBeenCalledOnce();
  });

  it('contains a fetch error behind the fallback and negative cache', async () => {
    const cache = createCache();
    const provider = new FaviconProvider(
      cache,
      vi.fn(async () => { throw new Error('offline'); }),
      { now: () => 2_000 },
    );
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });

    provider.ensureFetched('offline.example', finish);
    await settled;

    expect(provider.getCachedIcon('offline.example')).toBeUndefined();
    expect(cache.get('offline.example')).toEqual({ none: true, checkedAt: 2_000 });
  });

  it('always retries a legacy negative cache entry', async () => {
    const fetchFavicon = vi.fn(async () => FAVICON_BYTES);
    const provider = new FaviconProvider(
      createCache({ 'github.com': 'none' }),
      fetchFavicon,
    );
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });

    provider.ensureFetched('github.com', finish);
    await settled;

    expect(fetchFavicon).toHaveBeenCalledOnce();
    expect(provider.getCachedIcon('github.com')?.algoVersion).toBe(FAVICON_ALGORITHM_VERSION);
  });

  it('rebuilds an icon cached by an older algorithm version', async () => {
    const fetchFavicon = vi.fn(async () => FAVICON_BYTES);
    const provider = new FaviconProvider(createCache({
      'github.com': {
        light: 'data:image/png;base64,b2xk',
        dark: 'data:image/png;base64,b2xk',
        algoVersion: FAVICON_ALGORITHM_VERSION - 1,
      },
    }), fetchFavicon);
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });

    expect(provider.getCachedIcon('github.com')).toBeUndefined();
    provider.ensureFetched('github.com', finish);
    await settled;

    expect(fetchFavicon).toHaveBeenCalledOnce();
    expect(provider.getCachedIcon('github.com')).toEqual({
      light: expect.not.stringContaining('b2xk'),
      dark: expect.not.stringContaining('b2xk'),
      algoVersion: FAVICON_ALGORITHM_VERSION,
    });
  });

  it('rebuilds a legacy cached icon with no algorithm version', async () => {
    const fetchFavicon = vi.fn(async () => FAVICON_BYTES);
    const provider = new FaviconProvider(createCache({
      'github.com': {
        light: 'data:image/png;base64,bGVnYWN5',
        dark: 'data:image/png;base64,bGVnYWN5',
      },
    }), fetchFavicon);
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });

    provider.ensureFetched('github.com', finish);
    await settled;

    expect(fetchFavicon).toHaveBeenCalledOnce();
    expect(provider.getCachedIcon('github.com')?.algoVersion).toBe(FAVICON_ALGORITHM_VERSION);
  });
});
