import { TmuxControlClient } from './tmuxControlClient';
import { TERMINAL_SCROLLBACK_LINES } from './terminalScrollback';

export interface TmuxControlClientLike {
  start(sessionName: string, cwd: string, seedLines: number): Promise<void> | void;
  comeToFront(): Promise<void> | void;
  onOutput(handler: (data: string) => void): { dispose(): void };
  onSeed(handler: (seed: string) => void): { dispose(): void };
  onRename(handler: () => void): { dispose(): void };
  onExit(handler: (code: number | null) => void): { dispose(): void };
  sendKeys(data: string): Promise<void> | void;
  resize(cols: number, rows: number): Promise<void> | void;
  clearHistory(): Promise<void> | void;
  kill(): void;
}

export type TmuxControlClientFactory = (configPath: string) => TmuxControlClientLike;

const defaultClientFactory: TmuxControlClientFactory = (configPath) =>
  new TmuxControlClient(configPath);

export class TerminalTransport {
  private client: TmuxControlClientLike | undefined;
  private startPromise: Promise<void> | undefined;
  private frontClaim: Promise<void> | undefined;
  private ready = false;
  private exitEmitted = false;
  private size = { cols: 80, rows: 24 };
  private pendingSize: { cols: number; rows: number } | undefined;
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(code: number) => void>();
  private readonly renameHandlers = new Set<() => void>();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly configPath: string,
    private readonly clientFactory: TmuxControlClientFactory = defaultClientFactory,
  ) {}

  start(
    sessionName: string,
    cwd: string,
    cols: number,
    rows: number,
    front = false,
  ): Promise<void> | undefined {
    if (this.client) return this.startPromise;
    const size = this.pendingSize ?? { cols, rows };
    this.pendingSize = undefined;
    this.size = size;

    const client = this.clientFactory(this.configPath);
    this.client = client;
    this.disposables.push(
      client.onSeed((seed) => {
        const scrollback = normalizeSeedNewlines(trimSeedTrailingNewline(seed));
        if (scrollback) this.emitData(scrollback);
      }),
      client.onOutput((data) => this.emitData(data)),
      client.onRename(() => {
        for (const handler of this.renameHandlers) handler();
      }),
      client.onExit((code) => this.emitExit(code ?? 0)),
    );

    this.startPromise = Promise.resolve(client.start(sessionName, cwd, TERMINAL_SCROLLBACK_LINES))
      .then(async () => {
        if (this.client !== client) return;
        this.ready = true;
        // Claim before the repaint: a flagged tab's resizes are ignored while
        // another tab holds the width, which would swallow the SIGWINCH.
        if (front) await this.claimFront(client);
        return this.repaintAfterSeed(client);
      })
      .catch((error: unknown) => {
        if (this.client !== client) return;
        console.error('[deck] terminal transport failed to start:', error);
        client.kill();
        this.emitExit(1);
      });
    void Promise.resolve(client.resize(size.cols, size.rows)).catch(() => undefined);
    return this.startPromise;
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    this.dataHandlers.add(handler);
    return { dispose: () => this.dataHandlers.delete(handler) };
  }

  onExit(handler: (code: number) => void): { dispose(): void } {
    this.exitHandlers.add(handler);
    return { dispose: () => this.exitHandlers.delete(handler) };
  }

  onRename(handler: () => void): { dispose(): void } {
    this.renameHandlers.add(handler);
    return { dispose: () => this.renameHandlers.delete(handler) };
  }

  write(data: string): void {
    const client = this.client;
    if (!client) return;
    if (this.ready) {
      void Promise.resolve(client.sendKeys(data)).catch(() => undefined);
      return;
    }

    void this.startPromise?.then(() => {
      if (this.client === client && this.ready) {
        void Promise.resolve(client.sendKeys(data)).catch(() => undefined);
      }
    });
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    if (!this.client) {
      this.pendingSize = { cols, rows };
      return;
    }
    if (this.frontClaim) return;

    void Promise.resolve(this.client.resize(cols, rows)).catch(() => undefined);
  }

  comeToFront(): void {
    const client = this.client;
    if (!client || !this.ready || this.frontClaim) return;
    void this.claimFront(client);
  }

  // Replays the latest size even when the claim fails: resizes arriving while a
  // claim is in flight are deferred to here, and dropping them would leave the
  // pane at a stale size.
  private claimFront(client: TmuxControlClientLike): Promise<void> {
    const claim = Promise.resolve()
      .then(() => client.comeToFront())
      .catch(() => undefined)
      .then(() => {
        if (this.client !== client || !this.ready) return;
        return client.resize(this.size.cols, this.size.rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.frontClaim === claim) this.frontClaim = undefined;
      });
    this.frontClaim = claim;
    return claim;
  }

  // The reattach seed is capture-pane *text* plus one absolute cursor
  // reposition (ADR-0012 seed-cursor seam). When xterm re-wraps the captured
  // frame to a different row count than tmux, that reposition lands rows off,
  // and a full-screen TUI (Claude, vim) carries the offset forward through its
  // relative redraws. Perturbing the pane height by a row forces tmux to
  // deliver SIGWINCH, so the TUI repaints from scratch with absolute
  // positioning and the cursor snaps onto the right cell. A shell prompt
  // redraws in place; non-interactive output ignores the signal.
  private repaintAfterSeed(client: TmuxControlClientLike): Promise<void> {
    const { cols, rows } = this.size;
    return Promise.resolve(client.resize(cols, Math.max(1, rows - 1)))
      .then(() => {
        if (this.client === client) return client.resize(cols, rows);
      })
      .catch(() => undefined);
  }

  clearHistory(): void {
    void Promise.resolve(this.client?.clearHistory()).catch(() => undefined);
  }

  dispose(): void {
    this.kill();
  }

  kill(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.client?.kill();
    this.client = undefined;
    this.startPromise = undefined;
    this.frontClaim = undefined;
    this.ready = false;
    this.exitEmitted = false;
  }

  private emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  private emitExit(code: number): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    for (const handler of this.exitHandlers) handler(code);
  }
}

function trimSeedTrailingNewline(data: string): string {
  // Keep the full captured screen — including blank rows below the cursor — so
  // its geometry matches tmux and the explicit cursor reposition the control
  // client emits after the seed (CUP, from tmux's cursor_y/cursor_x) lands on
  // the right cell. Drop only the single trailing empty from capture-pane's
  // final newline, so we don't scroll one row past the bottom of the screen.
  const lines = data.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

function normalizeSeedNewlines(data: string): string {
  return data.replace(/\r?\n/g, '\r\n');
}
