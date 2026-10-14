import { describe, expect, it } from 'vitest';
import { tmuxPreflight } from '../src/terminal/tmuxPreflight';
import type { CommandRunner } from '../src/terminal/tmuxCli';

function runner(stdout: string): CommandRunner {
  return {
    run: async () => ({ code: 0, stdout, stderr: '' }),
  };
}

describe('tmuxPreflight', () => {
  it.each([
    ['tmux 3.4', true],
    ['tmux 3.2', true],
    ['tmux 3.1', false],
    ['tmux next-3.5', true],
    ['tmux 3.0a', false],
  ])('parses %s', async (stdout, available) => {
    const result = await tmuxPreflight(runner(stdout));

    expect(result.available).toBe(available);
    if (!available) expect(result.reason).toContain(stdout);
  });

  it('returns unavailable when tmux is missing', async () => {
    const result = await tmuxPreflight({
      run: async () => {
        throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
      },
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain('not found');
  });
});
