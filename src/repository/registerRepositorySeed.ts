import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDirSafe,
} from './repositoryCommonDirCache';

export interface RepositoryRegistryLike {
  list(): readonly string[];
  append(repositoryPath: string): Promise<void>;
}

export interface ActiveWorktreeStoreLike {
  set(commonDir: string, worktreePath: string): Promise<void>;
}

export interface SwitcherLike {
  switchTo(targetPath: string): Promise<void>;
}

export interface DetachedOpenerLike {
  open(targetPath: string): Promise<void>;
}

const SWITCH_LABEL = 'Switch';
const OPEN_IN_NEW_WINDOW_LABEL = 'Open in New Window';

export type RegisterRepositorySeedResult =
  | { kind: 'registered'; repositoryPath: string; commonDir: string }
  | { kind: 'duplicate'; repositoryPath: string; commonDir: string }
  | { kind: 'notGit'; repositoryPath: string };

export interface RegisterRepositorySeedOptions {
  seedPath: string;
  registry: RepositoryRegistryLike;
  activeWorktrees: ActiveWorktreeStoreLike;
  refresh: () => Promise<void> | void;
  reveal: (repositoryPath: string) => Promise<void>;
  repositoryCommonDirCache?: CommonDirCacheLike;
}

export async function registerRepositorySeed({
  seedPath,
  registry,
  activeWorktrees,
  refresh,
  reveal,
  repositoryCommonDirCache = PASS_THROUGH_COMMON_DIR_CACHE,
}: RegisterRepositorySeedOptions): Promise<RegisterRepositorySeedResult> {
  const commonDir = await resolveCommonDirSafe(repositoryCommonDirCache, seedPath);
  if (commonDir === null) {
    vscode.window.showErrorMessage(`Cannot add ${seedPath}: not a git repository.`);
    return { kind: 'notGit', repositoryPath: seedPath };
  }

  const isRegistered = await hasRegisteredCommonDir(registry, repositoryCommonDirCache, commonDir);
  if (isRegistered) return { kind: 'duplicate', repositoryPath: seedPath, commonDir };

  await registry.append(seedPath);
  await activeWorktrees.set(commonDir, seedPath);
  await refresh();
  await reveal(seedPath);
  return { kind: 'registered', repositoryPath: seedPath, commonDir };
}

export async function showRepositoryPostAddPrompt(
  repositoryPath: string,
  switcher: SwitcherLike,
  detachedOpener: DetachedOpenerLike,
): Promise<void> {
  const postAddAction = await vscode.window.showInformationMessage(
    `Added repository ${path.basename(repositoryPath)}.`,
    SWITCH_LABEL,
    OPEN_IN_NEW_WINDOW_LABEL,
  );
  if (postAddAction === SWITCH_LABEL) {
    await switcher.switchTo(repositoryPath);
  } else if (postAddAction === OPEN_IN_NEW_WINDOW_LABEL) {
    await detachedOpener.open(repositoryPath);
  }
}

async function hasRegisteredCommonDir(
  registry: RepositoryRegistryLike,
  repositoryCommonDirCache: CommonDirCacheLike,
  commonDir: string,
): Promise<boolean> {
  for (const repositoryPath of registry.list()) {
    const registered = await resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath);
    if (registered !== null && registered === commonDir) return true;
  }
  return false;
}
