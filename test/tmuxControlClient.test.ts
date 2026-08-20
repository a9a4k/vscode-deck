import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { TmuxControlClient, type TmuxControlSpawnFactory } from '../src/terminal/tmuxControlClient';

describe('TmuxControlClient', () => {
  it('starts tmux control mode, discovers the single pane, and seeds from capture-pane', async () => {
    const child = fakeChild();
    const spawn: TmuxControlSpawnFactory = vi.fn(() => child);
    const client = new TmuxControlClient('/ext/resources/deck.conf', spawn);

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);

    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nhistory\n%end 1 3 1\n');
    await started;

    expect(spawn).toHaveBeenCalledWith('tmux', [
      '-C',
      '-L',
      'deck',
      '-f',
      '/ext/resources/deck.conf',
      'new-session',
      '-A',
      '-s',
      'wt-_work_repo__term-1',
      '-e',
      'DECK_SESSION=wt-_work_repo__term-1',
      '-c',
      '/work/repo',
    ], { cwd: '/work/repo', stdio: 'pipe' });
    expect(child.writes).toEqual([
      'list-panes -s -t "=wt-_work_repo__term-1" -F "#{pane_id},#{cursor_y},#{cursor_x},#{alternate_on},#{mouse_standard_flag},#{mouse_button_flag},#{mouse_all_flag},#{mouse_sgr_flag},#{cursor_flag},#{keypad_cursor_flag},#{keypad_flag},#{bracket_paste_flag}"\n',
      'capture-pane -p -e -q -J -N -S -5000\n',
    ]);
  });

  it('quotes the pane-discovery target for session names with shell-significant characters', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));

    const started = client.start('wt-_work_my "repo"\\branch__term-1', '/work/my "repo"\\branch', 5000);

    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nhistory\n%end 1 3 1\n');
    await started;

    expect(child.writes[0]).toBe(
      'list-panes -s -t "=wt-_work_my \\"repo\\"\\\\branch__term-1" -F "#{pane_id},#{cursor_y},#{cursor_x},#{alternate_on},#{mouse_standard_flag},#{mouse_button_flag},#{mouse_all_flag},#{mouse_sgr_flag},#{cursor_flag},#{keypad_cursor_flag},#{keypad_flag},#{bracket_paste_flag}"\n',
    );
  });

  it('shares startup across overlapping start calls', async () => {
    const child = fakeChild();
    const spawn: TmuxControlSpawnFactory = vi.fn(() => child);
    const client = new TmuxControlClient('/ext/resources/deck.conf', spawn);

    const firstStart = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    const secondStart = client.start('wt-_work_repo__term-1', '/work/repo', 5000);

    expect(secondStart).toBe(firstStart);
    expect(spawn).toHaveBeenCalledTimes(1);

    await finishStart(child);
    await Promise.all([firstStart, secondStart]);
    expect(child.writes).toHaveLength(2);
  });

  it('drops pane output that predates the seed and dispatches the seed first', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const events: string[] = [];
    client.onSeed((seed) => events.push(`seed:${seed}`));
    client.onOutput((data) => events.push(`live:${data}`));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%output %0 before-attach\n%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%output %0 already-in-capture\n%begin 1 3 1\nhistory\n%end 1 3 1\n%output %0 fresh\n');
    await started;

    expect(events).toEqual(['seed:history', 'live:fresh']);
  });

  it('repositions the cursor from the pane state after seeding the content', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const seeds: string[] = [];
    client.onSeed((seed) => seeds.push(seed));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    // pane id, cursor_y, cursor_x
    child.emitStdout('%begin 1 2 1\n%0,3,7\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nhistory\n%end 1 3 1\n');
    await started;

    // content first, then an absolute reposition (CUP) to 1-based row 4, col 8.
    expect(seeds).toEqual(['history', '\x1b[4;8H']);
  });

  it('enters the alternate screen before the seed when a TUI is active', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const seeds: string[] = [];
    client.onSeed((seed) => seeds.push(seed));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    // pane id, cursor_y, cursor_x, alternate_on=1
    child.emitStdout('%begin 1 2 1\n%0,3,7,1\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nframe\n%end 1 3 1\n');
    await started;

    // Alt-screen enter first (so the captured frame fills xterm's alternate
    // buffer, not the normal one), then the frame, then the cursor reposition.
    expect(seeds).toEqual(['\x1b[?1049h\x1b[H', 'frame', '\x1b[4;8H']);
  });

  it('replays the pane terminal modes a running TUI set so a reattached tab keeps mouse reporting', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const seeds: string[] = [];
    client.onSeed((seed) => seeds.push(seed));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    // alt screen on; mouse button+SGR tracking on (standard/all off); cursor
    // hidden; application cursor keys + keypad on; bracketed paste on.
    child.emitStdout('%begin 1 2 1\n%0,3,7,1,0,1,0,1,0,1,1,1\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nframe\n%end 1 3 1\n');
    await started;

    expect(seeds).toEqual([
      '\x1b[?1049h\x1b[H\x1b[?1002h\x1b[?1006h\x1b[?25l\x1b[?1h\x1b=\x1b[?2004h',
      'frame',
      '\x1b[4;8H',
    ]);
  });

  it('tolerates a tmux that lacks a mode format (empty field) without shifting the others', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const seeds: string[] = [];
    client.onSeed((seed) => seeds.push(seed));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    // Normal screen, SGR mouse on, cursor visible, bracket_paste_flag unknown.
    child.emitStdout('%begin 1 2 1\n%0,0,0,0,1,0,0,1,1,0,0,\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\n$ \n%end 1 3 1\n');
    await started;

    expect(seeds).toEqual(['\x1b[?1000h\x1b[?1006h', '$ ', '\x1b[1;1H']);
  });

  it('opens the output gate even when the seed capture errors', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const events: string[] = [];
    client.onSeed((seed) => events.push(`seed:${seed}`));
    client.onOutput((data) => events.push(`live:${data}`));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nno history\n%error 1 3 1\n%output %0 fresh\n');
    await started;

    expect(events).toEqual(['live:fresh']);
  });

  it('decodes pane output escapes after reassembling UTF-8 across output events', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const output = vi.fn();

    client.onOutput(output);
    await startClient(client, child);

    child.emitStdout(Buffer.concat([
      Buffer.from('%output %0 hello\\015\\012slash=\\134 title=\\033kseq\\033\\134 ', 'utf8'),
      Buffer.from([0xc3]),
      Buffer.from('\n%output %0 ', 'utf8'),
      Buffer.from([0xa9]),
      Buffer.from('\n', 'utf8'),
    ]));

    expect(output.mock.calls.map(([data]) => data).join('')).toBe(
      'hello\r\nslash=\\ title= é',
    );
  });

  it('strips screen-style title sequences that xterm.js cannot parse', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const output = vi.fn();

    client.onOutput(output);
    await startClient(client, child);

    // ESC k title ST split across %output events; ESC k title BEL; real
    // escapes (SGR, lone ESC sequences) must survive untouched.
    child.emitStdout('%output %0 a\\033kech');
    child.emitStdout('o\\033');
    child.emitStdout('\\134b\n%output %0 \\033kvim\\007c \\033[32mgreen\\033[39m\n');

    expect(output.mock.calls.map(([data]) => data).join('')).toBe(
      'abc \x1b[32mgreen\x1b[39m',
    );
  });

  it('writes all sendKeys chunks of at most 4096 bytes in one burst', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const data = `${'a'.repeat(4096)}é`;
    const sent = client.sendKeys(data);

    // Both chunk commands hit stdin synchronously, before any reply — a
    // concurrent keystroke cannot interleave into the middle of a paste.
    expect(sendKeysByteLengths(child.writes.slice(2))).toEqual([4096, 2]);

    child.emitStdout('%begin 1 4 1\n%end 1 4 1\n%begin 1 5 1\n%end 1 5 1\n');
    await sent;
    expect(reassembleSendKeys(child.writes.slice(2))).toEqual(Buffer.from(data, 'utf8'));
  });

  it('correlates command replies FIFO while ignoring notifications', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const resized = client.resize(120, 40);
    const captured = client.capturePane(5);
    await untilWrites(child, 4);

    child.emitStdout('%sessions-changed\n%begin 1 4 1\n%end 1 4 1\n%window-close @1\n');
    await resized;
    child.emitStdout('%begin 1 5 1\nfirst line\nsecond line\n%end 1 5 1\n');

    await expect(captured).resolves.toBe('first line\nsecond line');
    expect(child.writes.slice(2)).toEqual([
      'refresh-client -C 120x40\n',
      'capture-pane -p -e -q -J -N -S -5\n',
    ]);
  });

  it('fires onRename for %window-renamed / %window-pane-changed notifications', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const renamed = vi.fn();
    client.onRename(renamed);
    await startClient(client, child);

    child.emitStdout('%window-renamed @0 vim\n');
    child.emitStdout('%window-pane-changed @0 %0\n');

    expect(renamed).toHaveBeenCalledTimes(2);
  });

  it('clears tmux history for the discovered pane', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const cleared = client.clearHistory();
    await untilWrites(child, 3);
    expect(child.writes.at(-1)).toBe('clear-history -t %0\n');

    child.emitStdout('%begin 1 4 1\n%end 1 4 1\n');
    await expect(cleared).resolves.toBeUndefined();
  });

  it('treats body lines that mimic %end as content when their numbers mismatch', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const captured = client.capturePane(5);
    await untilWrites(child, 3);
    child.emitStdout('%begin 1 4 1\n%end 9 9 9\n%error 9 9 9\nreal tail\n%end 1 4 1\n');

    await expect(captured).resolves.toBe('%end 9 9 9\n%error 9 9 9\nreal tail');
  });

  it('does not dequeue client commands for server-originated reply blocks', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const captured = client.capturePane(5);
    await untilWrites(child, 3);
    // flags=0 block (e.g. hook output) arrives before the real reply
    child.emitStdout('%begin 8 8 0\nhook noise\n%end 8 8 0\n%begin 1 4 1\nreal reply\n%end 1 4 1\n');

    await expect(captured).resolves.toBe('real reply');
  });

  it('falls back to the attach reply when the initial block is client-originated', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout('%begin 1 1 1\n%end 1 1 1\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\n%end 1 3 1\n');

    await expect(started).resolves.toBeUndefined();
  });

  it('rejects an errored reply with the in-block message', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const captured = client.capturePane(5);
    await untilWrites(child, 3);
    child.emitStdout('%begin 1 4 1\nparse error: yacc stack overflow\n%error 1 4 1\n');

    await expect(captured).rejects.toThrow('parse error: yacc stack overflow');
  });

  it('rejects startup and fires exit when the process fails to spawn', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const exit = vi.fn();
    client.onExit(exit);

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitError(new Error('spawn tmux ENOENT'));

    await expect(started).rejects.toThrow('spawn tmux ENOENT');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects pending replies when the process exits mid-startup', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitExit(1);

    await expect(started).rejects.toThrow('tmux control client exited (1)');
  });

  it('fires onExit once with the child process exit code', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const exit = vi.fn();
    client.onExit(exit);
    await startClient(client, child);

    child.emitStdout('%exit\n');
    child.emitExit(7);
    child.emitExit(9);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(7);
  });

  it('kills the control client process', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    client.kill();

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('replays the recorded control-mode transcript without losing seq output', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    let output = '';
    client.onOutput((data) => {
      output += data;
    });
    const transcript = readFileSync('prototypes/control-mode/transcript.txt');
    const attachEnd = endOf(transcript, '%end 1780851797 280 0\n');
    const listPanesEnd = endOf(transcript, '%end 1780851797 286 1\n');

    const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
    child.emitStdout(transcript.subarray(0, attachEnd));
    await untilWrites(child, 1);
    child.emitStdout(transcript.subarray(attachEnd, listPanesEnd));
    await untilWrites(child, 2);
    child.emitStdout('%begin 9 9 9\n%end 9 9 9\n');
    await started;
    child.emitStdout(transcript.subarray(listPanesEnd));

    expect(output).toContain('1\r\n2\r\n3\r\n');
    expect(output).toContain('999\r\n1000\r\n');
  });
});

function fakeChild() {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const writes: string[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      callback();
    },
  });

  return {
    stdout,
    stdin,
    writes,
    on: events.on.bind(events),
    kill: vi.fn(),
    emitStdout: (data: string | Buffer) => stdout.write(typeof data === 'string' ? Buffer.from(data, 'utf8') : data),
    emitExit: (code: number) => events.emit('exit', code),
    emitError: (error: Error) => events.emit('error', error),
  };
}

async function untilWrites(child: { writes: string[] }, count: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (child.writes.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`expected ${count} writes, got ${child.writes.length}`);
}

async function startClient(client: TmuxControlClient, child: ReturnType<typeof fakeChild>): Promise<void> {
  const started = client.start('wt-_work_repo__term-1', '/work/repo', 5000);
  await finishStart(child);
  await started;
}

async function finishStart(child: ReturnType<typeof fakeChild>): Promise<void> {
  child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
  await untilWrites(child, 1);
  child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
  await untilWrites(child, 2);
  child.emitStdout('%begin 1 3 1\n%end 1 3 1\n');
}

function endOf(transcript: Buffer, marker: string): number {
  const index = transcript.indexOf(Buffer.from(marker));
  if (index === -1) throw new Error(`marker not found in transcript: ${marker.trim()}`);
  return index + Buffer.byteLength(marker);
}

function sendKeysByteLengths(commands: string[]): number[] {
  return commands.map((command) => sendKeysHex(command).length / 2);
}

function reassembleSendKeys(commands: string[]): Buffer {
  return Buffer.from(commands.map(sendKeysHex).join(''), 'hex');
}

function sendKeysHex(command: string): string {
  const hexArgs = command.trim().split(' ').slice(4);
  return hexArgs.join('');
}
