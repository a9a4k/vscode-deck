import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { TextDecoder } from 'node:util';

export interface TmuxControlChild {
  stdout: Readable;
  stdin: Writable;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): void;
}

export type TmuxControlSpawnFactory = (
  file: string,
  args: string[],
  options: { cwd: string; stdio: 'pipe' },
) => TmuxControlChild;

const defaultSpawn: TmuxControlSpawnFactory = (file, args, options) =>
  spawn(file, args, options) as TmuxControlChild;

interface PendingReply {
  resolve(body: string): void;
  reject(error: Error): void;
  seed?: boolean;
}

// Terminal modes a TUI sets once at startup and that a freshly created xterm
// starts without (mouse reporting, hidden cursor, application cursor keys /
// keypad, bracketed paste). tmux tracks them per pane and exposes each as a
// format flag; the seed replays the ones that are on so a reattached tab
// behaves like the tab the TUI originally configured — a redraw (SIGWINCH)
// alone does not make TUIs re-send them. Format name, flag value that needs
// a replay, and the sequence that sets it.
const PANE_MODES: ReadonlyArray<[format: string, whenFlagIs: '0' | '1', sequence: string]> = [
  ['mouse_standard_flag', '1', '\x1b[?1000h'],
  ['mouse_button_flag', '1', '\x1b[?1002h'],
  ['mouse_all_flag', '1', '\x1b[?1003h'],
  ['mouse_sgr_flag', '1', '\x1b[?1006h'],
  ['cursor_flag', '0', '\x1b[?25l'],
  ['keypad_cursor_flag', '1', '\x1b[?1h'],
  ['keypad_flag', '1', '\x1b='],
  ['bracket_paste_flag', '1', '\x1b[?2004h'],
];

// Comma-separated so a format tmux does not know (older than our preflight
// floor may lack bracket_paste_flag) expands to an empty field instead of
// shifting the ones after it.
const PANE_STATE_FORMAT = ['#{pane_id}', '#{cursor_y}', '#{cursor_x}', '#{alternate_on}', ...PANE_MODES.map(([format]) => `#{${format}}`)].join(',');

export class TmuxControlClient {
  private child: TmuxControlChild | undefined;
  private startPromise: Promise<void> | undefined;
  private lineBuffer = Buffer.alloc(0);
  private paneId: string | undefined;
  private activeReply: { token: string; clientOriginated: boolean; body: string[] } | undefined;
  private attachReply: PendingReply | undefined;
  private readonly pendingReplies: PendingReply[] = [];
  private readonly outputHandlers = new Set<(data: string) => void>();
  private readonly seedHandlers = new Set<(seed: string) => void>();
  private readonly renameHandlers = new Set<() => void>();
  private readonly exitHandlers = new Set<(code: number | null) => void>();
  private readonly paneDecoder = new TextDecoder();
  private titleFilterState: TitleFilterState = 'text';
  private exitFired = false;
  // Pane bytes streamed before the seed capture-pane reply are already inside
  // the capture; the gate drops them so the seed is the single source and
  // reattach never duplicates content (ADR-0012 decision 5). The gate opens
  // synchronously when the seed reply's %end is parsed, so seed-then-live
  // ordering is exact stream order.
  private outputGated = true;

  constructor(
    private readonly configPath: string,
    private readonly spawnFactory: TmuxControlSpawnFactory = defaultSpawn,
  ) {}

  start(sessionName: string, cwd: string, seedLines: number): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startControlClient(sessionName, cwd, seedLines);
    return this.startPromise;
  }

  private async startControlClient(sessionName: string, cwd: string, seedLines: number): Promise<void> {
    // The attach reply is the one server-originated (flags=0) block we expect;
    // it must not occupy the client-command FIFO.
    const attach = new Promise<string>((resolve, reject) => {
      this.attachReply = { resolve, reject };
    });
    this.child = this.spawnFactory('tmux', [
      '-C',
      '-L',
      'deck',
      '-f',
      this.configPath,
      'new-session',
      '-A',
      '-s',
      sessionName,
      // Set DECK_SESSION on the create-or-attach path too, so a session this
      // client creates (e.g. reopening after a mid-window server death) still
      // carries the env var the agent hook keys on. Ignored by tmux on attach.
      '-e',
      `DECK_SESSION=${sessionName}`,
      '-c',
      cwd,
    ], { cwd, stdio: 'pipe' });

    this.child.stdout.on('data', (chunk: Buffer) => this.acceptStdout(chunk));
    this.child.on('exit', (code) => this.fireExit(code));
    this.child.on('error', (error: Error) => {
      this.failPendingReplies(error);
      this.fireExit(1);
    });

    await attach;
    // Fetch the cursor position alongside the pane id in the one list-panes we
    // already issue — capture-pane restores the screen text but no cursor, so
    // without this the cursor sits at end-of-content until the next redraw. The
    // canonical control-mode client (iTerm2) likewise reads cursor_x/cursor_y as
    // pane state apart from the content.
    const fields = (await this.command(`list-panes -s -t ${controlModeTarget(sessionName)} -F "${PANE_STATE_FORMAT}"`))
      .trim()
      .split('\n')
      .filter(Boolean);
    if (fields.length !== 1) {
      throw new Error(`expected exactly one tmux pane, got ${fields.length}`);
    }
    const [paneId, cursorRow, cursorColumn, alternateOn, ...modeFlags] = fields[0].split(',');
    this.paneId = paneId;

    // A full-screen TUI (Claude, vim, …) runs in the terminal's alternate screen.
    // capture-pane grabs the *visible* screen, so when one is active the seed is a
    // snapshot of the alt screen. Enter the alt screen here, before the seed, so it
    // fills xterm's alternate buffer; otherwise the snapshot lands in the normal
    // buffer and bleeds through (stale, with its colours) when the TUI exits the
    // alt screen. The matching exit (\x1b[?1049l) arrives live when the TUI quits.
    // The pane's other modes ride along (see PANE_MODES); their matching resets
    // likewise arrive live from the TUI.
    const modes = (alternateOn === '1' ? '\x1b[?1049h\x1b[H' : '')
      + PANE_MODES.map(([, whenFlagIs, sequence], i) => (modeFlags[i] === whenFlagIs ? sequence : '')).join('');
    if (modes) {
      for (const handler of this.seedHandlers) handler(modes);
    }
    // -q: a pane that died between attach and capture is not a startup error.
    // -N: preserve trailing spaces (tmux >= 3.1, our preflight floor).
    // A failed capture costs history, not the terminal: the gate still opens
    // on the %error so live output flows.
    await this.command(`capture-pane -p -e -q -J -N -S -${seedLines}`, { seed: true }).catch(() => undefined);

    // Emit an absolute reposition (CUP) after the seed so the cursor lands where
    // the shell/TUI's input is, not at end-of-content.
    const row = Number(cursorRow);
    const column = Number(cursorColumn);
    if (Number.isInteger(row) && Number.isInteger(column)) {
      for (const handler of this.seedHandlers) handler(`\x1b[${row + 1};${column + 1}H`);
    }
  }

  onOutput(handler: (data: string) => void): { dispose(): void } {
    this.outputHandlers.add(handler);
    return { dispose: () => this.outputHandlers.delete(handler) };
  }

  onSeed(handler: (seed: string) => void): { dispose(): void } {
    this.seedHandlers.add(handler);
    return { dispose: () => this.seedHandlers.delete(handler) };
  }

  onRename(handler: () => void): { dispose(): void } {
    this.renameHandlers.add(handler);
    return { dispose: () => this.renameHandlers.delete(handler) };
  }

  onExit(handler: (code: number | null) => void): { dispose(): void } {
    this.exitHandlers.add(handler);
    return { dispose: () => this.exitHandlers.delete(handler) };
  }

  async sendKeys(data: string): Promise<void> {
    if (!this.paneId) throw new Error('tmux control client has not started');
    const bytes = Buffer.from(data, 'utf8');
    if (bytes.length === 0) return;
    // Write all chunks in one synchronous burst so a concurrent sendKeys
    // (a keystroke during a large paste) cannot interleave between chunks.
    const replies: Array<Promise<string>> = [];
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const chunk = bytes.subarray(offset, offset + 4096);
      const hexBytes = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0'));
      replies.push(this.command(`send-keys -t ${this.paneId} -H ${hexBytes.join(' ')}`));
    }
    await Promise.all(replies);
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.command(`refresh-client -C ${cols}x${rows}`);
  }

  async clearHistory(): Promise<void> {
    if (!this.paneId) throw new Error('tmux control client has not started');
    await this.command(`clear-history -t ${this.paneId}`);
  }

  async capturePane(lines: number): Promise<string> {
    return this.command(`capture-pane -p -e -q -J -N -S -${lines}`);
  }

  kill(): void {
    this.child?.kill();
  }

  private command(command: string, options: { seed?: boolean } = {}): Promise<string> {
    if (!this.child) throw new Error('tmux control client has not started');
    const reply = this.enqueueReply(options.seed);
    this.child.stdin.write(`${command}\n`);
    return reply;
  }

  private enqueueReply(seed?: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingReplies.push({ resolve, reject, seed });
    });
  }

  private acceptStdout(chunk: Buffer): void {
    this.lineBuffer = Buffer.concat([this.lineBuffer, chunk]);

    for (;;) {
      const newline = this.lineBuffer.indexOf(0x0a);
      if (newline === -1) return;

      const line = this.lineBuffer.subarray(0, newline);
      this.lineBuffer = this.lineBuffer.subarray(newline + 1);
      this.acceptLine(line);
    }
  }

  private acceptLine(line: Buffer): void {
    const text = line.toString('utf8');

    if (this.activeReply) {
      // Pane content can contain lines that look like protocol — only a
      // %end/%error whose <ts> <num> matches the opening %begin closes the
      // reply; everything else is body.
      if (replyToken(text, '%end ') === this.activeReply.token) {
        this.closeReply(true);
        return;
      }
      if (replyToken(text, '%error ') === this.activeReply.token) {
        this.closeReply(false);
        return;
      }
      this.activeReply.body.push(text);
      return;
    }

    if (text.startsWith('%begin ')) {
      this.activeReply = {
        token: replyToken(text, '%begin ') ?? '',
        clientOriginated: replyIsClientOriginated(text),
        body: [],
      };
      return;
    }

    if (text.startsWith('%output ')) {
      this.acceptOutput(line);
      return;
    }

    if (text.startsWith('%exit')) return;

    // automatic-rename fires this when the foreground command changes
    // (zsh -> vim); surface it so the tree can re-read the row label live.
    if (text.startsWith('%window-renamed') || text.startsWith('%window-pane-changed')) {
      for (const handler of this.renameHandlers) handler();
      return;
    }

    if (text.startsWith('%')) {
      console.debug(`[deck] ignoring tmux control-mode notification: ${text}`);
    }
  }

  private closeReply(ok: boolean): void {
    const body = this.activeReply?.body.join('\n') ?? '';
    const clientOriginated = this.activeReply?.clientOriginated ?? true;
    this.activeReply = undefined;

    // Server-originated blocks (flags=0) do not belong to our command FIFO —
    // dequeuing on them would desync every later reply. The attach block is
    // the one we expect; any other is swallowed.
    if (!clientOriginated) {
      const attach = this.takeAttachReply();
      if (!attach) {
        console.debug(`[deck] ignoring server-originated tmux reply block: ${body}`);
        return;
      }
      if (ok) attach.resolve(body);
      else attach.reject(new Error(body || 'tmux attach failed'));
      return;
    }

    // Nothing in the FIFO: if attach is still pending this must be it (tmux
    // could plausibly flag the new-session block client-originated).
    const reply = this.pendingReplies.shift() ?? this.takeAttachReply();
    if (reply?.seed) {
      this.outputGated = false;
      if (ok) for (const handler of this.seedHandlers) handler(body);
    }
    if (!reply) return;
    if (ok) reply.resolve(body);
    else reply.reject(new Error(body || 'tmux command failed'));
  }

  private takeAttachReply(): PendingReply | undefined {
    const attach = this.attachReply;
    this.attachReply = undefined;
    return attach;
  }

  private acceptOutput(line: Buffer): void {
    if (this.outputGated) return;
    const firstSpace = line.indexOf(0x20);
    const secondSpace = line.indexOf(0x20, firstSpace + 1);
    if (secondSpace === -1) return;

    const payload = line.subarray(secondSpace + 1);
    const bytes = this.stripScreenTitleSequences(decodeOctalEscapes(payload));
    const output = this.paneDecoder.decode(bytes, { stream: true });
    if (output.length === 0) return;
    for (const handler of this.outputHandlers) handler(output);
  }

  // Shells under TERM=tmux-256color emit screen-style title sequences
  // (ESC k <title> ST|BEL) to name the tmux window. A rendering tmux consumes
  // them, but control mode forwards raw pane bytes — and xterm.js doesn't
  // implement ESC k, so it prints the title as literal text. Swallow them
  // here; tmux already processed them server-side, so automatic-rename and
  // the sidebar labels are unaffected. Stateful: sequences split across
  // %output events.
  private stripScreenTitleSequences(bytes: Buffer): Buffer {
    const out: number[] = [];
    for (const byte of bytes) {
      switch (this.titleFilterState) {
        case 'text':
          if (byte === 0x1b) {
            this.titleFilterState = 'esc';
            continue;
          }
          out.push(byte);
          continue;
        case 'esc':
          if (byte === 0x6b /* k */) {
            this.titleFilterState = 'title';
            continue;
          }
          out.push(0x1b);
          if (byte === 0x1b) continue; // stay in 'esc' for the new ESC
          out.push(byte);
          this.titleFilterState = 'text';
          continue;
        case 'title':
          if (byte === 0x1b) this.titleFilterState = 'title-esc';
          else if (byte === 0x07 /* BEL */) this.titleFilterState = 'text';
          continue;
        case 'title-esc':
          if (byte === 0x5c /* \ */) this.titleFilterState = 'text';
          else if (byte !== 0x1b) this.titleFilterState = 'title';
          continue;
      }
    }
    return Buffer.from(out);
  }

  private fireExit(code: number | null): void {
    if (this.exitFired) return;
    this.exitFired = true;
    this.failPendingReplies(new Error(`tmux control client exited (${code ?? 'killed'})`));
    for (const handler of this.exitHandlers) handler(code);
  }

  private failPendingReplies(error: Error): void {
    this.activeReply = undefined;
    this.takeAttachReply()?.reject(error);
    for (const reply of this.pendingReplies.splice(0)) reply.reject(error);
  }
}

type TitleFilterState = 'text' | 'esc' | 'title' | 'title-esc';

function controlModeTarget(sessionName: string): string {
  return `"=${sessionName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function replyToken(text: string, prefix: string): string | undefined {
  if (!text.startsWith(prefix)) return undefined;
  const fields = text.slice(prefix.length).split(' ');
  if (fields.length < 2) return undefined;
  return `${fields[0]} ${fields[1]}`;
}

// %begin <ts> <num> <flags>: flags bit 0 set = reply to a command this client
// sent. Missing flags defaults to client-originated, after iTerm2's gateway.
function replyIsClientOriginated(text: string): boolean {
  const fields = text.split(' ');
  if (fields.length < 4) return true;
  const flags = Number.parseInt(fields[3], 10);
  if (Number.isNaN(flags)) return true;
  return (flags & 1) === 1;
}

function decodeOctalEscapes(input: Buffer): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    if (
      input[i] === 0x5c &&
      i + 3 < input.length &&
      isOctal(input[i + 1]) &&
      isOctal(input[i + 2]) &&
      isOctal(input[i + 3])
    ) {
      bytes.push(Number.parseInt(input.subarray(i + 1, i + 4).toString('ascii'), 8));
      i += 3;
      continue;
    }
    bytes.push(input[i]);
  }
  return Buffer.from(bytes);
}

function isOctal(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x37;
}
