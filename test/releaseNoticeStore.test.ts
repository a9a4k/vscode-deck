import { describe, expect, it } from 'vitest';
import { ReleaseNoticeStore } from '../src/releaseNoticeStore';

describe('ReleaseNoticeStore', () => {
  it('round-trips the last seen Deck version', async () => {
    const values: Record<string, unknown> = {};
    const store = new ReleaseNoticeStore({
      get: <T>(key: string) => values[key] as T | undefined,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    });

    expect(store.get()).toBeUndefined();

    await store.set('0.23.0');

    expect(store.get()).toBe('0.23.0');
  });
});
