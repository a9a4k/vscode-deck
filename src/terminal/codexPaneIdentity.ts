import { basename } from 'node:path';

export interface CodexPaneIdentity {
  agentName: 'codex';
  hasNoDaemon: boolean;
}

export async function resolveCodexPaneIdentity(
  windowName: string,
  readForegroundCommandLine: () => Promise<string | undefined>,
): Promise<CodexPaneIdentity | undefined> {
  if (windowName !== 'codex' && windowName !== 'node') return undefined;

  const commandLine = await readForegroundCommandLine();
  if (!commandLine) return undefined;
  const words = commandLine.trim().split(/\s+/);
  const programIndex = windowName === 'codex'
    ? 0
    : words.findIndex((word) => basename(word) === 'codex.js');
  if (programIndex === -1) return undefined;

  return {
    agentName: 'codex',
    hasNoDaemon: words.slice(programIndex + 1).includes('--no-daemon'),
  };
}
