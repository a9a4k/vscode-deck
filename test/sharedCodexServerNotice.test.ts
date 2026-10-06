import { describe, expect, it, vi } from 'vitest';
import {
  SharedCodexServerNotice,
  type SharedCodexServerMarkerSource,
  type SharedCodexWorktree,
} from '../src/agent/sharedCodexServerNotice';

describe('SharedCodexServerNotice', () => {
  it('warns with the Repository and Worktree branch for the first marker', async () => {
    const harness = startNotice([
      { path: '/work/repo', repo: 'vscode-deck', branch: 'feature' },
    ]);

    harness.marker.fire(sharedMarker({ cwd: '/work/repo/src' }));

    await vi.waitFor(() => {
      expect(harness.notifications.showWarningMessage).toHaveBeenCalledWith(
        'vscode-deck/feature: Codex is using its shared background server, so Deck cannot show its status or resume it. Restart Codex with --no-daemon.',
        'Open Launcher Settings',
        'Learn More',
      );
    });
    harness.dispose();
  });

  it('does not repeat for the same server and Worktree', async () => {
    const harness = startNotice([
      { path: '/work/repo', repo: 'deck', branch: 'main' },
    ]);

    harness.marker.fire(sharedMarker());
    await vi.waitFor(() => expect(harness.notifications.showWarningMessage).toHaveBeenCalledOnce());
    harness.marker.fire(sharedMarker({ at: 1710000001 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.notifications.showWarningMessage).toHaveBeenCalledOnce();
    harness.dispose();
  });

  it('warns again when the same server appears in a new Worktree', async () => {
    const harness = startNotice([
      { path: '/work/one', repo: 'deck', branch: 'one' },
      { path: '/work/two', repo: 'deck', branch: 'two' },
    ]);

    harness.marker.fire(sharedMarker({ sessionId: 'one', cwd: '/work/one' }));
    await vi.waitFor(() => expect(harness.notifications.showWarningMessage).toHaveBeenCalledTimes(1));
    harness.marker.fire(sharedMarker({ sessionId: 'two', cwd: '/work/two', at: 1710000001 }));

    await vi.waitFor(() => expect(harness.notifications.showWarningMessage).toHaveBeenCalledTimes(2));
    expect(harness.notifications.showWarningMessage.mock.calls[1]?.[0]).toMatch(/^deck\/two:/);
    harness.dispose();
  });

  it('warns again when a new shared server starts in the same Worktree', async () => {
    const harness = startNotice([
      { path: '/work/repo', repo: 'deck', branch: 'main' },
    ]);

    harness.marker.fire(sharedMarker());
    await vi.waitFor(() => expect(harness.notifications.showWarningMessage).toHaveBeenCalledTimes(1));
    harness.marker.fire(sharedMarker({ serverPid: 456, sessionId: 'two', at: 1710000001 }));

    await vi.waitFor(() => expect(harness.notifications.showWarningMessage).toHaveBeenCalledTimes(2));
    harness.dispose();
  });

  it('uses the longest containing Worktree path', async () => {
    const harness = startNotice([
      { path: '/work/repo', repo: 'deck', branch: 'main' },
      { path: '/work/repo/nested', repo: 'deck', branch: 'nested' },
    ]);

    harness.marker.fire(sharedMarker({ cwd: '/work/repo/nested/src' }));

    await vi.waitFor(() => {
      expect(harness.notifications.showWarningMessage.mock.calls[0]?.[0]).toMatch(/^deck\/nested:/);
    });
    harness.dispose();
  });

  it('uses a generic warning outside registered Worktrees', async () => {
    const harness = startNotice();

    harness.marker.fire(sharedMarker({ cwd: '/elsewhere' }));

    await vi.waitFor(() => {
      expect(harness.notifications.showWarningMessage.mock.calls[0]?.[0]).toBe(
        'Codex is using its shared background server, so Deck cannot show its status or resume it. Restart Codex with --no-daemon.',
      );
    });
    harness.dispose();
  });

  it('ignores missing and malformed markers', async () => {
    const harness = startNotice();

    harness.marker.fire(undefined);
    harness.marker.fire({ serverPid: '123', cwd: '/work/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.notifications.showWarningMessage).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('opens launcher settings from the warning action', async () => {
    const harness = startNotice([], 'Open Launcher Settings');

    harness.marker.fire(sharedMarker({ cwd: '/elsewhere' }));

    await vi.waitFor(() => expect(harness.openLauncherSettings).toHaveBeenCalledOnce());
    harness.dispose();
  });

  it('opens the documentation from the warning action', async () => {
    const harness = startNotice([], 'Learn More');

    harness.marker.fire(sharedMarker({ cwd: '/elsewhere' }));

    await vi.waitFor(() => expect(harness.learnMore).toHaveBeenCalledOnce());
    harness.dispose();
  });
});

function startNotice(worktrees: readonly SharedCodexWorktree[] = [], choice?: string) {
  const marker = new FakeMarkerSource();
  const notifications = { showWarningMessage: vi.fn(async () => choice) };
  const openLauncherSettings = vi.fn();
  const learnMore = vi.fn();
  const disposable = new SharedCodexServerNotice({
    marker,
    worktrees: { list: () => worktrees },
    notifications,
    openLauncherSettings,
    learnMore,
  }).start();
  return {
    marker,
    notifications,
    openLauncherSettings,
    learnMore,
    dispose: () => disposable.dispose(),
  };
}

function sharedMarker(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverPid: 123,
    sessionId: 'codex-123',
    cwd: '/work/repo',
    at: 1710000000,
    ...overrides,
  };
}

class FakeMarkerSource implements SharedCodexServerMarkerSource {
  private value: unknown;
  private listener: (() => void) | undefined;

  async read(): Promise<unknown> {
    return this.value;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listener = listener;
    return { dispose: () => { this.listener = undefined; } };
  }

  fire(value: unknown): void {
    this.value = value;
    this.listener?.();
  }
}
