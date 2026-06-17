import { describe, expect, it, vi } from 'vitest';
import { revealWithRetry } from '../src/tree/revealWithRetry';

const noSleep = () => Promise.resolve();

describe('revealWithRetry', () => {
  it('reveals once when the first attempt succeeds', async () => {
    const reveal = vi.fn(async () => undefined);

    await expect(revealWithRetry(reveal, { sleep: noSleep })).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('retries until reveal succeeds once the tree model catches up', async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    const reveal = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('Cannot resolve tree item');
    });

    await expect(revealWithRetry(reveal, { sleep })).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts', async () => {
    const reveal = vi.fn(async () => {
      throw new Error('Cannot resolve tree item');
    });

    await expect(revealWithRetry(reveal, { attempts: 4, sleep: noSleep })).resolves.toBe(false);
    expect(reveal).toHaveBeenCalledTimes(4);
  });
});
