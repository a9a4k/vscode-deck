import { describe, expect, it } from 'vitest';
import { FAVICON_CACHE_KEY, FaviconCache } from '../src/bookmark/faviconCache';

function createCache() {
  const values: Record<string, unknown> = {};
  const memento = {
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  };
  return { cache: new FaviconCache(memento), values };
}

describe('FaviconCache', () => {
  it('persists a host icon for synchronous reads', async () => {
    const { cache, values } = createCache();
    const icon = {
      light: 'data:image/png;base64,bGlnaHQ=',
      dark: 'data:image/png;base64,ZGFyaw==',
      algoVersion: 2,
    };

    await cache.set('example.com', icon);

    expect(cache.get('example.com')).toEqual(icon);
    expect(values[FAVICON_CACHE_KEY]).toEqual({ 'example.com': icon });
  });

  it('keeps negative and legacy entries independent by host', async () => {
    const { cache } = createCache();

    await cache.set('missing.example', { none: true, checkedAt: 1_000 });
    await cache.set('legacy.example', 'none');

    expect(cache.get('missing.example')).toEqual({ none: true, checkedAt: 1_000 });
    expect(cache.get('legacy.example')).toBe('none');
    expect(cache.get('unknown.example')).toBeUndefined();
  });
});
