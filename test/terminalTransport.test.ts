import { describe, expect, it, vi } from 'vitest';
import { TerminalTransport, type TmuxControlClientFactory } from '../src/terminal/terminalTransport';

describe('TerminalTransport', () => {
  it('starts a tmux control client with the seed depth and applies the initial size', () => {
    const client = fakeClient();
    const factory: TmuxControlClientFactory = vi.fn(() => client);
    const transport = new TerminalTransport('/ext/resources/deck.conf', factory);

    transport.start('wt-_work_repo__term-1', '/work/repo', 120, 32);

    expect(factory).toHaveBeenCalledWith('/ext/resources/deck.conf');
    expect(client.start).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
      '/work/repo',
      5000,
    );
    expect(client.resize).toHaveBeenCalledWith(120, 32);
  });

  it('perturbs the pane height after startup so a restored TUI repaints onto the right cell', async () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 120, 32);

    // Initial size dimensions the seed/capture correctly; the one-row shrink and
    // restore force the SIGWINCH that makes the foreground TUI repaint.
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(3));
    expect(client.resize.mock.calls).toEqual([
      [120, 32],
      [120, 31],
      [120, 32],
    ]);
  });

  it('forwards control output, writes, resize, exit events, and dispose', async () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();
    const exit = vi.fn();

    transport.onData(data);
    transport.onExit(exit);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    await Promise.resolve();

    client.emitOutput('hello');
    transport.write('ls\n');
    transport.resize(100, 40);
    transport.clearHistory();
    client.emitExit(7);
    transport.dispose();

    expect(data).toHaveBeenCalledWith('hello');
    expect(client.sendKeys).toHaveBeenCalledWith('ls\n');
    expect(client.resize).toHaveBeenLastCalledWith(100, 40);
    expect(client.clearHistory).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(7);
    expect(client.kill).toHaveBeenCalledOnce();
  });

  it('forwards client rename events to onRename subscribers', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const renamed = vi.fn();

    transport.onRename(renamed);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    client.emitRename();

    expect(renamed).toHaveBeenCalledOnce();
  });

  it('forwards the seed and live output in client order', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    client.emitSeed('seed');
    client.emitOutput('live\r\n');

    expect(data.mock.calls.map(([payload]) => payload)).toEqual(['seed', 'live\r\n']);
  });

  it('keeps the full captured screen, dropping only the trailing newline artifact', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    // capture-pane fills the pane height with blank rows below the prompt and
    // ends in a newline; keep the blank rows so the screen geometry matches tmux
    // (the control client repositions the cursor with an explicit CUP), and drop
    // only the final-newline artifact so we don't scroll one row past the bottom.
    client.emitSeed('output\n❯ \n\n\n');

    expect(data).toHaveBeenCalledWith('output\r\n❯ \r\n\r\n');
  });

  it('normalizes captured line feeds for xterm replay', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    client.emitSeed('one\ntwo');

    expect(data).toHaveBeenCalledWith('one\r\ntwo');
  });

  it('emits nothing for an empty seed', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    client.emitSeed('');

    expect(data).not.toHaveBeenCalled();
  });

  it('uses the latest resize as the initial control-client size when resize arrives before start', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.resize(100, 30);
    transport.resize(132, 41);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    expect(client.resize).toHaveBeenCalledTimes(1);
    expect(client.resize).toHaveBeenCalledWith(132, 41);
  });

  it('replays the latest size after its tab comes to the front', async () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(3));
    transport.resize(132, 41);
    client.comeToFront.mockClear();
    client.resize.mockClear();

    transport.comeToFront();
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledWith(132, 41));

    expect(client.comeToFront).toHaveBeenCalledOnce();
    expect(client.comeToFront.mock.invocationCallOrder[0])
      .toBeLessThan(client.resize.mock.invocationCallOrder[0]);
  });

  it('defers resize events until a FrontTab claim finishes', async () => {
    let finishClaim: (() => void) | undefined;
    const client = fakeClient();
    client.comeToFront.mockReturnValue(new Promise<void>((resolve) => {
      finishClaim = resolve;
    }));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(3));
    client.resize.mockClear();

    transport.comeToFront();
    transport.resize(132, 41);
    expect(client.resize).not.toHaveBeenCalled();

    finishClaim?.();
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledWith(132, 41));
  });

  it('claims the FrontTab before the seed repaint so the program receives it', async () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 120, 32, true);
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(4));

    const shrink = client.resize.mock.calls.findIndex(([, rows]) => rows === 31);
    expect(client.comeToFront).toHaveBeenCalledOnce();
    expect(client.comeToFront.mock.invocationCallOrder[0])
      .toBeLessThan(client.resize.mock.invocationCallOrder[shrink]);
  });

  it('does not claim the FrontTab at start for a background tab', async () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 120, 32, false);
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(3));

    expect(client.comeToFront).not.toHaveBeenCalled();
  });

  it('still applies the latest size when a FrontTab claim fails', async () => {
    const client = fakeClient();
    client.comeToFront.mockRejectedValue(new Error('session is gone'));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(3));
    client.resize.mockClear();

    transport.comeToFront();
    transport.resize(132, 41);

    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledWith(132, 41));
  });

  it('ignores a FrontTab claim before the control client is ready', async () => {
    let finishStart: (() => void) | undefined;
    const client = fakeClient();
    client.start.mockReturnValue(new Promise<void>((resolve) => {
      finishStart = resolve;
    }));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    transport.comeToFront();
    expect(client.comeToFront).not.toHaveBeenCalled();

    finishStart?.();
    await vi.waitFor(() => expect(client.resize).toHaveBeenCalledTimes(3));
    expect(client.comeToFront).not.toHaveBeenCalled();
  });

  it('waits for startup before forwarding writes to the control client', async () => {
    let resolveStart: (() => void) | undefined;
    const client = fakeClient();
    client.start.mockReturnValue(new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    transport.write('echo ok\n');

    expect(client.sendKeys).not.toHaveBeenCalled();

    resolveStart?.();
    await vi.waitFor(() => expect(client.sendKeys).toHaveBeenCalledWith('echo ok\n'));
  });

  it('emits a single exit and kills the client when startup fails', async () => {
    const client = fakeClient();
    client.start.mockRejectedValue(new Error('expected exactly one tmux pane, got 0'));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const exit = vi.fn();

    transport.onExit(exit);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    await vi.waitFor(() => expect(client.kill).toHaveBeenCalledOnce());
    client.emitExit(0);

    expect(client.kill).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('drops queued writes when startup fails instead of sending to a dead client', async () => {
    const client = fakeClient();
    client.start.mockRejectedValue(new Error('attach failed'));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    transport.write('echo ok\n');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(client.sendKeys).not.toHaveBeenCalled();
  });

  it('does not let a stale startup mark a restarted client as ready', async () => {
    let resolveFirstStart: (() => void) | undefined;
    let resolveSecondStart: (() => void) | undefined;
    const firstClient = fakeClient();
    const secondClient = fakeClient();
    firstClient.start.mockReturnValue(new Promise<void>((resolve) => {
      resolveFirstStart = resolve;
    }));
    secondClient.start.mockReturnValue(new Promise<void>((resolve) => {
      resolveSecondStart = resolve;
    }));
    const transport = new TerminalTransport(
      '/ext/resources/deck.conf',
      vi.fn()
        .mockReturnValueOnce(firstClient)
        .mockReturnValueOnce(secondClient),
    );

    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    transport.kill();
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    resolveFirstStart?.();
    await Promise.resolve();
    transport.write('echo ok\n');

    expect(secondClient.sendKeys).not.toHaveBeenCalled();

    resolveSecondStart?.();
    await vi.waitFor(() => expect(secondClient.sendKeys).toHaveBeenCalledWith('echo ok\n'));
  });
});

function fakeClient() {
  let outputHandler: ((data: string) => void) | undefined;
  let seedHandler: ((seed: string) => void) | undefined;
  let exitHandler: ((code: number | null) => void) | undefined;
  let renameHandler: (() => void) | undefined;
  return {
    start: vi.fn(),
    comeToFront: vi.fn(),
    sendKeys: vi.fn(),
    resize: vi.fn(),
    clearHistory: vi.fn(),
    onOutput: vi.fn((handler: (data: string) => void) => {
      outputHandler = handler;
      return { dispose: vi.fn() };
    }),
    onSeed: vi.fn((handler: (seed: string) => void) => {
      seedHandler = handler;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((handler: (code: number | null) => void) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    }),
    onRename: vi.fn((handler: () => void) => {
      renameHandler = handler;
      return { dispose: vi.fn() };
    }),
    kill: vi.fn(),
    emitOutput: (data: string) => outputHandler?.(data),
    emitSeed: (seed: string) => seedHandler?.(seed),
    emitExit: (code: number | null) => exitHandler?.(code),
    emitRename: () => renameHandler?.(),
  };
}
