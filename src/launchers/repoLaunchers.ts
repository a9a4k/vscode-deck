import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTerminalLaunchers, type TerminalLauncher } from './terminalLaunchers';

export async function readRepoLaunchers(worktreePath: string): Promise<TerminalLauncher[]> {
  try {
    const text = await readFile(join(worktreePath, '.deck', 'launchers.json'), 'utf8');
    return parseTerminalLaunchers(JSON.parse(text));
  } catch {
    return [];
  }
}
