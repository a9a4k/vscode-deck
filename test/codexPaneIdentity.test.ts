import { describe, expect, it, vi } from 'vitest';
import { resolveCodexPaneIdentity } from '../src/terminal/codexPaneIdentity';

describe('resolveCodexPaneIdentity', () => {
  it.each([
    ['native shared', 'codex', '/opt/codex --yolo', { agentName: 'codex', hasNoDaemon: false }],
    ['native unshared', 'codex', '/opt/codex --no-daemon', { agentName: 'codex', hasNoDaemon: true }],
    [
      'npm shared',
      'node',
      '/usr/bin/node /usr/local/lib/node_modules/@openai/codex/bin/codex.js --yolo',
      { agentName: 'codex', hasNoDaemon: false },
    ],
    [
      'npm unshared',
      'node',
      '/usr/bin/node /usr/local/lib/node_modules/@openai/codex/bin/codex.js --no-daemon',
      { agentName: 'codex', hasNoDaemon: true },
    ],
    ['unrelated node', 'node', '/usr/bin/node /work/server.js', undefined],
    [
      'prompt text after program word',
      'codex',
      '/opt/codex explain --no-daemon',
      { agentName: 'codex', hasNoDaemon: true },
    ],
  ])('resolves %s', async (_case, windowName, commandLine, expected) => {
    await expect(resolveCodexPaneIdentity(windowName, async () => commandLine)).resolves.toEqual(expected);
  });

  it('does not read a command line for a non-Codex window name', async () => {
    const readForegroundCommandLine = vi.fn(async () => '/opt/codex');

    await expect(resolveCodexPaneIdentity('zsh', readForegroundCommandLine)).resolves.toBeUndefined();
    expect(readForegroundCommandLine).not.toHaveBeenCalled();
  });
});
