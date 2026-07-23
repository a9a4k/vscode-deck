import { describe, expect, it, vi } from 'vitest';
import { TerminalPoll, type TerminalPollScheduler } from '../src/terminal/terminalPoll';
import type { TmuxSession } from '../src/terminal/tmuxCli';

describe('TerminalPoll', () => {
  it('emits changed agent sessions when resolved labels change', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ first task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const listSessions = vi.fn(async () => sessions);
    const poll = new TerminalPoll({
      listSessions,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ renamed task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();

    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ renamed task' },
    ]);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('emits a session-set change when a new session appears after the baseline', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const sessionSetChanges = vi.fn();
    poll.onDidChangeSessionSet(sessionSetChanges);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();

    expect(sessionSetChanges).toHaveBeenCalledOnce();
  });

  it('emits a session-set change when a session disappears after the baseline', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const sessionSetChanges = vi.fn();
    poll.onDidChangeSessionSet(sessionSetChanges);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    await scheduler.runNext();

    expect(sessionSetChanges).toHaveBeenCalledOnce();
  });

  it('does not emit a session-set change on the first tick', async () => {
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => [
        { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
      ]),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler: new ManualScheduler(),
    });
    const sessionSetChanges = vi.fn();
    poll.onDidChangeSessionSet(sessionSetChanges);

    poll.start();
    await flush();

    expect(sessionSetChanges).not.toHaveBeenCalled();
  });

  it('does not emit a session-set change when the session names are unchanged', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const sessionSetChanges = vi.fn();
    poll.onDidChangeSessionSet(sessionSetChanges);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();

    expect(sessionSetChanges).not.toHaveBeenCalled();
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
      isFocused: () => focused,
      onDidChangeFocus: (handler) => {
        focusHandler = handler;
        return { dispose: vi.fn() };
      },
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);
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

  it('detects session-set changes on refocus after the timer was paused', async () => {
    const scheduler = new ManualScheduler();
    let focused = true;
    let focusHandler: ((focused: boolean) => void) | undefined;
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new TerminalPoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => focused,
      onDidChangeFocus: (handler) => {
        focusHandler = handler;
        return { dispose: vi.fn() };
      },
      scheduler,
    });
    const sessionSetChanges = vi.fn();
    poll.onDidChangeSessionSet(sessionSetChanges);
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

    expect(sessionSetChanges).toHaveBeenCalledOnce();
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
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);

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
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      resolveAgentName: vi.fn(async (sessionName: string) =>
        sessionName === 'term-1' ? 'claude' : undefined,
      ),
    });
    const changes = vi.fn();
    poll.onChange(changes);

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
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);

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
    const poll = new TerminalPoll({
      listSessions,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      onError,
    });
    const sessionSetChanges = vi.fn();
    poll.onDidChangeSessionSet(sessionSetChanges);

    poll.start();
    await flush();

    await scheduler.runNext();
    await flush();

    expect(onError).toHaveBeenCalledWith(error);
    expect(scheduler.hasTick()).toBe(true);

    await scheduler.runNext();
    await flush();

    expect(sessionSetChanges).toHaveBeenCalledOnce();
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
