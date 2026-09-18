import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    tabGroups: {
      all: [],
      onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
      close: vi.fn(async () => true),
    },
    showWarningMessage: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(async () => undefined),
  },
}));

import { DisconnectedTabWatch, type DisconnectedTabWatchSurface } from '../src/terminal/disconnectedTabWatch';

describe('DisconnectedTabWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('closes only restored Deck tabs whose Terminals no longer exist', async () => {
    const surface = new FakeSurface([
      tab('live', false),
      tab('stale', false),
    ]);
    const listSessions = vi.fn(async () => [{ sessionName: 'live' }]);
    const reopen = vi.fn(async () => undefined);
    const watch = createWatch(surface, {
      listSessions,
      beforeStaleTabSweep: async () => undefined,
      reopen,
    });

    watch.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(surface.closedSessionNames).toEqual(['stale']);
    expect(listSessions).toHaveBeenCalledOnce();
    expect(reopen).not.toHaveBeenCalled();
  });

  it('waits for TerminalSnapshot restore before judging restored tabs', async () => {
    const surface = new FakeSurface([tab('restored', false)]);
    let restored = false;
    let finishRestore = () => undefined;
    const beforeStaleTabSweep = () => new Promise<void>((resolve) => {
      finishRestore = () => {
        restored = true;
        resolve();
      };
    });
    const listSessions = vi.fn(async () => restored ? [{ sessionName: 'restored' }] : []);
    const watch = createWatch(surface, { beforeStaleTabSweep, listSessions });

    watch.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(listSessions).not.toHaveBeenCalled();
    expect(surface.closedSessionNames).toEqual([]);

    finishRestore();
    await vi.advanceTimersByTimeAsync(0);

    expect(listSessions).toHaveBeenCalledOnce();
    expect(surface.closedSessionNames).toEqual([]);
  });

  it('leaves restored tabs open when the DeckSocket listing fails', async () => {
    const surface = new FakeSurface([tab('term-1', false)]);
    const listSessions = vi.fn(async (): Promise<Array<{ sessionName: string }>> => {
      throw new Error('DeckSocket unavailable');
    });
    const watch = createWatch(surface, {
      beforeStaleTabSweep: async () => undefined,
      listSessions,
    });

    watch.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(listSessions).toHaveBeenCalledOnce();
    expect(surface.closedSessionNames).toEqual([]);
  });

  it('badges and prompts only after an active Deck tab stays unwired past grace', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const notifications = fakeNotifications(undefined);
    const reopen = vi.fn(async () => undefined);
    const watch = createWatch(surface, { notifications, reopen });
    const changed: unknown[][] = [];
    watch.onDidChangeDisconnectedTabs((uris) => changed.push([...uris]));

    watch.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(watch.isDisconnected('term-1')).toBe(false);
    expect(notifications.showWarningMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(watch.isDisconnected('term-1')).toBe(true);
    expect(changed).toEqual([[{ scheme: 'deck-terminal', path: '/repo/term-1' }]]);
    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      'Deck Terminal tabs were disconnected by an extension restart.',
      'Reopen Terminals',
    );
    await Promise.resolve();
    expect(reopen).not.toHaveBeenCalled();
  });

  it('does not badge a tab that resolves within the grace window', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const panels = new Set<string>();
    const watch = createWatch(surface, { panelFor: (sessionName) => panels.has(sessionName) ? {} : undefined });

    watch.start();
    await vi.advanceTimersByTimeAsync(500);
    panels.add('term-1');
    await vi.advanceTimersByTimeAsync(500);

    expect(watch.isDisconnected('term-1')).toBe(false);
  });

  it('judges an activation only after that session gets its own grace window', async () => {
    const surface = new FakeSurface([
      tab('term-a', true),
      tab('term-b', false),
    ]);
    const panels = new Set<string>();
    const watch = createWatch(surface, { panelFor: (sessionName) => panels.has(sessionName) ? {} : undefined });

    watch.start();
    surface.fireTabsChanged();
    await vi.advanceTimersByTimeAsync(450);
    surface.activate('term-b');
    await vi.advanceTimersByTimeAsync(499);
    panels.add('term-b');
    await vi.advanceTimersByTimeAsync(51);

    expect(watch.isDisconnected('term-a')).toBe(false);
    expect(watch.isDisconnected('term-b')).toBe(false);
  });

  it('cancels a pending judgment when the same session reopens', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const panels = new Set<string>();
    const watch = createWatch(surface, { panelFor: (sessionName) => panels.has(sessionName) ? {} : undefined });

    watch.start();
    surface.fireTabsChanged();
    await vi.advanceTimersByTimeAsync(250);
    surface.close('term-1');
    surface.open(tab('term-1', true));
    await vi.advanceTimersByTimeAsync(250);

    expect(watch.isDisconnected('term-1')).toBe(false);

    panels.add('term-1');
    await vi.advanceTimersByTimeAsync(250);

    expect(watch.isDisconnected('term-1')).toBe(false);
  });

  it('runs the reopen flow when the notification action is selected', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const notifications = fakeNotifications('Reopen Terminals');
    const reopen = vi.fn(async () => {
      surface.close('term-1');
    });
    const watch = createWatch(surface, { notifications, reopen });

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(reopen).toHaveBeenCalledOnce();
    expect(watch.isDisconnected('term-1')).toBe(false);
  });

  it('keeps skipped disconnected tabs badged after accepting reopen', async () => {
    const surface = new FakeSurface([
      tab('repaired', true),
      tab('skipped', true),
    ]);
    const notifications = fakeNotifications('Reopen Terminals');
    const reopen = vi.fn(async () => {
      surface.close('repaired');
    });
    const watch = createWatch(surface, { notifications, reopen });

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(reopen).toHaveBeenCalledOnce();
    expect(watch.isDisconnected('repaired')).toBe(false);
    expect(watch.isDisconnected('skipped')).toBe(true);
  });

  it('does not re-prompt after dismissal while the badged tab stays active', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const notifications = fakeNotifications(undefined);
    const watch = createWatch(surface, { notifications });

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();

    surface.fireTabsChanged();
    await vi.advanceTimersByTimeAsync(500);
    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    surface.fireTabsChanged();
    await vi.advanceTimersByTimeAsync(500);

    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
  });

  it('prompts for a newly proven disconnected tab after the throttle', async () => {
    const surface = new FakeSurface([
      tab('term-1', true),
      tab('term-2', false),
    ]);
    const notifications = fakeNotifications(undefined);
    const watch = createWatch(surface, { notifications });

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    surface.activate('term-2');
    await vi.advanceTimersByTimeAsync(500);

    expect(watch.isDisconnected('term-2')).toBe(true);
    expect(notifications.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it('forgets a disconnected tab when the user closes it', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const watch = createWatch(surface);
    const changed: unknown[][] = [];
    watch.onDidChangeDisconnectedTabs((uris) => changed.push([...uris]));

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    surface.close('term-1');

    expect(watch.isDisconnected('term-1')).toBe(false);
    expect(changed.at(-1)).toEqual([{ scheme: 'deck-terminal', path: '/repo/term-1' }]);
  });

  it('forgets a badged session observed with a live panel', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const panels = new Set<string>();
    const watch = createWatch(surface, { panelFor: (sessionName) => panels.has(sessionName) ? {} : undefined });
    const changed: unknown[][] = [];
    watch.onDidChangeDisconnectedTabs((uris) => changed.push([...uris]));

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    panels.add('term-1');
    surface.fireTabsChanged();

    expect(watch.isDisconnected('term-1')).toBe(false);
    expect(changed.at(-1)).toEqual([{ scheme: 'deck-terminal', path: '/repo/term-1' }]);
  });
});

function createWatch(
  surface: FakeSurface,
  overrides: Partial<ConstructorParameters<typeof DisconnectedTabWatch>[0]> = {},
): DisconnectedTabWatch {
  return new DisconnectedTabWatch({
    surface,
    panelFor: () => undefined,
    notifications: fakeNotifications(undefined),
    reopen: vi.fn(async () => undefined),
    ...overrides,
  });
}

function fakeNotifications(choice?: string) {
  return {
    showWarningMessage: vi.fn(async () => choice),
  };
}

function tab(sessionName: string, isActive: boolean) {
  return {
    sessionName,
    uri: { scheme: 'deck-terminal', path: `/repo/${sessionName}` } as never,
    isActive,
  };
}

class FakeSurface implements DisconnectedTabWatchSurface {
  private listener: ((event: { closedSessionNames: readonly string[] }) => void) | undefined;
  readonly closedSessionNames: string[] = [];

  constructor(private readonly tabs: Array<ReturnType<typeof tab>>) {}

  activeDeckTabs(): ReturnType<typeof tab>[] {
    return this.tabs.filter((candidate) => candidate.isActive);
  }

  async closeDeckTabsWithoutSessions(liveSessionNames: ReadonlySet<string>): Promise<void> {
    this.closedSessionNames.push(
      ...this.tabs
        .filter((candidate) => !liveSessionNames.has(candidate.sessionName))
        .map((candidate) => candidate.sessionName),
    );
  }

  onDidChangeTabs(listener: (event: { closedSessionNames: readonly string[] }) => void) {
    this.listener = listener;
    return { dispose: vi.fn() };
  }

  fireTabsChanged(): void {
    this.listener?.({ closedSessionNames: [] });
  }

  activate(sessionName: string): void {
    for (const candidate of this.tabs) candidate.isActive = candidate.sessionName === sessionName;
    this.fireTabsChanged();
  }

  open(tab: ReturnType<typeof tab>): void {
    this.tabs.push(tab);
    this.fireTabsChanged();
  }

  close(sessionName: string): void {
    const index = this.tabs.findIndex((candidate) => candidate.sessionName === sessionName);
    if (index !== -1) this.tabs.splice(index, 1);
    this.listener?.({ closedSessionNames: [sessionName] });
  }
}
