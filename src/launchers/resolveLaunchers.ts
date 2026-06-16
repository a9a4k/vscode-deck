import { readRepoLaunchers } from './repoLaunchers';
import { parseTerminalLaunchers, type TerminalLauncher } from './terminalLaunchers';

export interface LauncherGroups {
  repo: TerminalLauncher[];
  user: TerminalLauncher[];
}

export async function resolveLaunchers(
  worktreePath: string,
  userLauncherConfig: unknown,
  readRepo: (worktreePath: string) => Promise<TerminalLauncher[]> = readRepoLaunchers,
): Promise<LauncherGroups> {
  return {
    repo: await readRepo(worktreePath),
    user: parseTerminalLaunchers(userLauncherConfig),
  };
}

export function hasLaunchers(groups: LauncherGroups): boolean {
  return groups.repo.length > 0 || groups.user.length > 0;
}
