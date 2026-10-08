import { describe, expect, it, vi } from 'vitest';
import {
  CodexNoDaemonBanner,
  type CodexNoDaemonBannerScheduler,
} from '../src/terminal/codexNoDaemonBanner';
import type { CodexSharedServerState } from '../src/terminal/codexSharedServerProbe';

describe('CodexNoDaemonBanner', () => {
  it('shows an affected Terminal after a later shared-server retry succeeds', async () => {
    const scheduler = new ManualScheduler();
    const probe = vi.fn<() => Promise<CodexSharedServerState>>()
      .mockResolvedValueOnce('absent')
      .mockResolvedValueOnce('live');
    const show = vi.fn();
    const banner = new CodexNoDaemonBanner({
      probe: { probe },
      settings: { isEnabled: () => true, disable: vi.fn(async () => undefined) },
      scheduler,
      show,
      hide: vi.fn(),
    });

    banner.observe([sharedCodex('term-1')]);
    expect(scheduler.nextDelay()).toBe(1000);

    await scheduler.runNext();
    expect(show).not.toHaveBeenCalled();
    expect(scheduler.nextDelay()).toBe(4000);

    await scheduler.runNext();
    expect(show).toHaveBeenCalledWith('term-1');
  });

  it('does not show a banner when every shared-server retry is absent', async () => {
    const scheduler = new ManualScheduler();
    const show = vi.fn();
    const banner = new CodexNoDaemonBanner({
      probe: { probe: vi.fn(async () => 'absent' as const) },
      settings: { isEnabled: () => true, disable: vi.fn(async () => undefined) },
      scheduler,
      show,
      hide: vi.fn(),
    });

    banner.observe([sharedCodex('term-1')]);
    await scheduler.runNext();
    await scheduler.runNext();
    await scheduler.runNext();

    expect(show).not.toHaveBeenCalled();
    expect(scheduler.nextDelay()).toBeUndefined();
  });

  it('does not probe when the warning setting is off', () => {
    const scheduler = new ManualScheduler();
    const probe = vi.fn(async () => 'live' as const);
    const banner = new CodexNoDaemonBanner({
      probe: { probe },
      settings: { isEnabled: () => false, disable: vi.fn(async () => undefined) },
      scheduler,
      show: vi.fn(),
      hide: vi.fn(),
    });

    banner.observe([sharedCodex('term-1')]);

    expect(scheduler.nextDelay()).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it('does not probe for Codex started with --no-daemon', () => {
    const scheduler = new ManualScheduler();
    const probe = vi.fn(async () => 'live' as const);
    const banner = new CodexNoDaemonBanner({
      probe: { probe },
      settings: { isEnabled: () => true, disable: vi.fn(async () => undefined) },
      scheduler,
      show: vi.fn(),
      hide: vi.fn(),
    });

    banner.observe([{
      sessionName: 'term-1',
      identity: { agentName: 'codex', hasNoDaemon: true },
    }]);

    expect(scheduler.nextDelay()).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it('hides the banner when Codex exits the Terminal', async () => {
    const scheduler = new ManualScheduler();
    const hide = vi.fn();
    const banner = new CodexNoDaemonBanner({
      probe: { probe: vi.fn(async () => 'live' as const) },
      settings: { isEnabled: () => true, disable: vi.fn(async () => undefined) },
      scheduler,
      show: vi.fn(),
      hide,
    });
    banner.observe([sharedCodex('term-1')]);
    await scheduler.runNext();

    banner.observe([]);

    expect(hide).toHaveBeenCalledWith('term-1');
  });

  it('dismisses one Codex run but warns again for a new run', async () => {
    const scheduler = new ManualScheduler();
    const show = vi.fn();
    const hide = vi.fn();
    const banner = new CodexNoDaemonBanner({
      probe: { probe: vi.fn(async () => 'live' as const) },
      settings: { isEnabled: () => true, disable: vi.fn(async () => undefined) },
      scheduler,
      show,
      hide,
    });
    banner.observe([sharedCodex('term-1')]);
    await scheduler.runNext();

    banner.dismiss('term-1');
    banner.observe([sharedCodex('term-1')]);

    expect(hide).toHaveBeenCalledOnce();
    expect(scheduler.nextDelay()).toBeUndefined();

    banner.observe([]);
    banner.observe([sharedCodex('term-1')]);
    await scheduler.runNext();

    expect(show).toHaveBeenCalledTimes(2);
  });

  it("Don't Show Again disables the setting and hides every banner", async () => {
    const scheduler = new ManualScheduler();
    const disable = vi.fn(async () => undefined);
    const hide = vi.fn();
    const banner = new CodexNoDaemonBanner({
      probe: { probe: vi.fn(async () => 'live' as const) },
      settings: { isEnabled: () => true, disable },
      scheduler,
      show: vi.fn(),
      hide,
    });
    banner.observe([sharedCodex('term-1'), sharedCodex('term-2')]);
    await scheduler.runNext();
    await scheduler.runNext();

    await banner.disable();

    expect(disable).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledWith('term-1');
    expect(hide).toHaveBeenCalledWith('term-2');
  });
});

function sharedCodex(sessionName: string) {
  return {
    sessionName,
    identity: { agentName: 'codex' as const, hasNoDaemon: false },
  };
}

class ManualScheduler implements CodexNoDaemonBannerScheduler {
  private tasks: Array<{ callback: () => void; delay: number }> = [];

  setTimeout(callback: () => void, delay: number): unknown {
    const task = { callback, delay };
    this.tasks.push(task);
    return task;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((task) => task !== handle);
  }

  nextDelay(): number | undefined {
    return this.tasks[0]?.delay;
  }

  async runNext(): Promise<void> {
    const task = this.tasks.shift();
    if (!task) throw new Error('no scheduled task');
    task.callback();
    await vi.waitFor(() => undefined);
  }
}
