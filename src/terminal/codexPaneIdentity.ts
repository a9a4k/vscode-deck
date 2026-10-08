import { basename } from 'node:path';

const CODEX_PROGRAMS = new Set(['codex', 'codex.js']);

export interface CodexPaneIdentity {
  agentName: 'codex';
  hasNoDaemon: boolean;
}

// `paneCommand` is tmux's `pane_current_command`: the foreground program's name,
// whatever the window is named. npm's Codex runs as `node …/codex.js`.
export function mayRunCodex(paneCommand: string): boolean {
  return paneCommand === 'codex' || paneCommand === 'node';
}

export async function resolveCodexPaneIdentity(
  paneCommand: string,
  readForegroundCommandLine: () => Promise<string | undefined>,
): Promise<CodexPaneIdentity | undefined> {
  if (!mayRunCodex(paneCommand)) return undefined;

  const commandLine = await readForegroundCommandLine();
  if (!commandLine) return undefined;
  const words = commandLine.trim().split(/\s+/);
  const programIndex = words.findIndex((word) => CODEX_PROGRAMS.has(basename(word)));
  if (programIndex === -1) return undefined;

  return {
    agentName: 'codex',
    hasNoDaemon: words.slice(programIndex + 1).includes('--no-daemon'),
  };
}
