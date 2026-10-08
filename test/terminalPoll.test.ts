import { describe, expect, it, vi } from 'vitest';
import { TerminalPoll, type TerminalPollScheduler } from '../src/terminal/terminalPoll';
import type { TmuxSession } from '../src/terminal/tmuxCli';

describe('TerminalPoll', () => {
  it('resolves an npm Codex pane to Codex identity and banner observation', async () => {
    const scheduler = new ManualScheduler();
    const reconcile = vi.fn(async () => undefined);
    const observeCodexPanes = vi.fn();
    const resolveCodexPaneIdentity = vi.fn(async () => ({
      agentName: 'codex' as const,
      hasNoDaemon: false,
    }));
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => [
        { sessionName: 'term-1', windowName: 'node', paneCommand: 'node', paneTitle: '⠋ npm Codex' },
      ]),
      reconcileObservation: reconcile,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      readForegroundProcessIds: async () => new Map([['term-1', 4321]]),
      resolveCodexPaneIdentity,
      observeCodexPanes,
    });

    poll.start();
    await flush();

    expect(reconcile).toHaveBeenCalledWith([
      {
        sessionName: 'term-1',
        windowName: 'node',
        paneCommand: 'node',
        paneTitle: '⠋ npm Codex',
        agentName: 'codex',
      },
    ]);
    expect(observeCodexPanes).toHaveBeenCalledWith([{
      sessionName: 'term-1',
      identity: { agentName: 'codex', hasNoDaemon: false },
      processId: 4321,
    }]);

    await scheduler.runNext();
    await flush();

    expect(resolveCodexPaneIdentity).toHaveBeenCalledOnce();
  });

  it('re-reads a Codex restarted under the same window name', async () => {
    const scheduler = new ManualScheduler();
    const observeCodexPanes = vi.fn();
    let foregroundProcessId = 101;
    const resolveCodexPaneIdentity = vi.fn(async (_windowName: string, processId: number) => ({
      agentName: 'codex' as const,
      hasNoDaemon: processId === 101,
    }));
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => [
        { sessionName: 'term-1', windowName: 'codex', paneCommand: 'codex', paneTitle: '' },
      ]),
      reconcileObservation: vi.fn(async () => undefined),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      readForegroundProcessIds: async () => new Map([['term-1', foregroundProcessId]]),
      resolveCodexPaneIdentity,
      observeCodexPanes,
    });
    poll.start();
    await flush();

    foregroundProcessId = 202;
    await scheduler.runNext();
    await flush();

    expect(resolveCodexPaneIdentity).toHaveBeenLastCalledWith('codex', 202);
    expect(observeCodexPanes).toHaveBeenLastCalledWith([{
      sessionName: 'term-1',
      identity: { agentName: 'codex', hasNoDaemon: false },
      processId: 202,
    }]);
  });

  it('finds Codex by foreground command when a custom format names the window', async () => {
    const reconcile = vi.fn(async () => undefined);
    const observeCodexPanes = vi.fn();
    const readForegroundProcessIds = vi.fn(async () => new Map([['term-1', 4321]]));
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => [
        { sessionName: 'term-1', windowName: 'vscode-deck', paneCommand: 'codex', paneTitle: '' },
        { sessionName: 'term-2', windowName: 'codex', paneCommand: 'zsh', paneTitle: '' },
      ]),
      reconcileObservation: reconcile,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler: new ManualScheduler(),
      readForegroundProcessIds,
      resolveCodexPaneIdentity: async () => ({ agentName: 'codex' as const, hasNoDaemon: false }),
      observeCodexPanes,
    });

    poll.start();
    await flush();

    expect(readForegroundProcessIds).toHaveBeenCalledWith(['term-1']);
    expect(observeCodexPanes).toHaveBeenCalledWith([
      { sessionName: 'term-1', identity: { agentName: 'codex', hasNoDaemon: false }, processId: 4321 },
      { sessionName: 'term-2' },
    ]);
    expect(reconcile.mock.calls[0][0][0]).toMatchObject({ sessionName: 'term-1', agentName: 'codex' });
  });

  it('hands each observed Terminal set to reconciliation with resolved agent identities', async () => {
    const reconcile = vi.fn(async () => undefined);
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha__term-1', windowName: '2.1.172', paneTitle: '✳ task' },
      ]),
      reconcileObservation: reconcile,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler: new ManualScheduler(),
      resolveAgentName: vi.fn(async () => 'claude'),
    });

    poll.start();
    await flush();

    expect(reconcile).toHaveBeenCalledWith([
      {
        sessionName: 'wt-_work_alpha__term-1',
        windowName: '2.1.172',
        paneTitle: '✳ task',
        agentName: 'claude',
      },
    ]);
  });

  it('wakes for an immediate extra observation while focused', async () => {
    const scheduler = new ManualScheduler();
    const listSessions = vi.fn(async () => []);
    const poll = new TerminalPoll({
      listSessions,
      reconcileObservation: () => undefined,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    poll.start();
    await flush();

    poll.wake();
    await flush();

    expect(listSessions).toHaveBeenCalledTimes(2);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('runs a requested wake immediately after an in-flight observation', async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const listSessions = vi.fn()
      .mockImplementationOnce(async () => {
        await first;
        return [];
      })
      .mockResolvedValue([]);
    const poll = new TerminalPoll({
      listSessions,
      reconcileObservation: () => undefined,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler: new ManualScheduler(),
    });
    poll.start();
    await Promise.resolve();

    poll.wake();
    releaseFirst?.();
    await flush();

    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('emits changed agent sessions when resolved labels change', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ first task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const listSessions = vi.fn(async () => sessions);
    const poll = new TerminalPoll({
      listSessions,
      reconcileObservation: () => undefined,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onDidChangeLabels(changes);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ renamed task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();
    await flush();

    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ renamed task' },
    ]);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('pauses while unfocused and catches up on refocus', async () => {
    const scheduler = new ManualScheduler();
    let focused = true;
    let focusHandler: ((focused: boolean) => void) | undefined;
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'codex', paneTitle: '⠋ first task' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      reconcileObservation: () => undefined,
      isFocused: () => focused,
      onDidChangeFocus: (handler) => {
        focusHandler = handler;
        return { dispose: vi.fn() };
      },
      scheduler,
    });
    const changes = vi.fn();
    poll.onDidChangeLabels(changes);
    poll.start();
    await flush();

    focused = false;
    focusHandler?.(false);
    sessions = [{ sessionName: 'term-1', windowName: 'codex', paneTitle: '⠋ renamed task' }];
    expect(scheduler.hasTick()).toBe(false);

    focused = true;
    focusHandler?.(true);
    await flush();

    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'codex', paneTitle: '⠋ renamed task' },
    ]);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('reconciles sessions on refocus after the timer was paused', async () => {
    const scheduler = new ManualScheduler();
    let focused = true;
    let focusHandler: ((focused: boolean) => void) | undefined;
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const observations = vi.fn(async () => undefined);
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      reconcileObservation: observations,
      isFocused: () => focused,
      onDidChangeFocus: (handler) => {
        focusHandler = handler;
        return { dispose: vi.fn() };
      },
      scheduler,
    });
    poll.start();
    await flush();

    focused = false;
    focusHandler?.(false);
    sessions = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];

    focused = true;
    focusHandler?.(true);
    await flush();

    expect(observations).toHaveBeenLastCalledWith(sessions);
    expect(observations).toHaveBeenCalledTimes(2);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('does not fire when only a non-agent terminal changes its pane title', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ steady task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      reconcileObservation: () => undefined,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onDidChangeLabels(changes);

    poll.start();
    await flush();

    // Only the shell's pane title churns (e.g. a `cd`); the agent's title is
    // unchanged. A non-agent label is its window name, so this must not fire —
    // the agent keeps the poll scheduling.
    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ steady task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();

    expect(changes).not.toHaveBeenCalled();
  });

  it('emits known agent sessions when a volatile window name would otherwise hide the AgentTitle', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: '2.1.172', paneTitle: '✳ first task' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      reconcileObservation: () => undefined,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      resolveAgentName: vi.fn(async (sessionName: string) =>
        sessionName === 'term-1' ? 'claude' : undefined,
      ),
    });
    const changes = vi.fn();
    poll.onDidChangeLabels(changes);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: '2.1.172', paneTitle: '✳ renamed task' },
    ];
    await scheduler.runNext();
    await flush();

    expect(changes).toHaveBeenCalledWith([
      {
        sessionName: 'term-1',
        windowName: '2.1.172',
        paneTitle: '✳ renamed task',
        agentName: 'claude',
      },
    ]);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('keeps polling after a zero-agent tick', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      reconcileObservation: () => undefined,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onDidChangeLabels(changes);

    poll.start();
    await flush();
    expect(scheduler.hasTick()).toBe(true);

    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ started agent' },
    ];
    await scheduler.runNext();
    await flush();

    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ started agent' },
    ]);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('keeps polling after a transient list-sessions failure', async () => {
    const scheduler = new ManualScheduler();
    const error = new Error('tmux server restarting');
    const listSessions = vi.fn()
      .mockResolvedValueOnce([
        { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
      ])
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([
        { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
        { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
      ]);
    const onError = vi.fn();
    const observations = vi.fn(async () => undefined);
    const poll = new TerminalPoll({
      listSessions,
      reconcileObservation: observations,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      onError,
    });

    poll.start();
    await flush();

    await scheduler.runNext();
    await flush();

    expect(onError).toHaveBeenCalledWith(error);
    expect(scheduler.hasTick()).toBe(true);

    await scheduler.runNext();
    await flush();

    expect(observations).toHaveBeenCalledTimes(2);
    expect(observations).toHaveBeenLastCalledWith([
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ]);
  });
});

class ManualScheduler implements TerminalPollScheduler {
  private next: (() => void) | undefined;

  setTimeout(callback: () => void, _ms: number): unknown {
    this.next = callback;
    return callback;
  }

  clearTimeout(handle: unknown): void {
    if (this.next === handle) this.next = undefined;
  }

  hasTick(): boolean {
    return this.next !== undefined;
  }

  async runNext(): Promise<void> {
    const callback = this.next;
    if (!callback) throw new Error('no scheduled tick');
    this.next = undefined;
    callback();
    await Promise.resolve();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
