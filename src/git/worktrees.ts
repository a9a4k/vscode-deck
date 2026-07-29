import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { worktreeCreationTimes } from './worktreeCreationTimes';

const exec = promisify(execFile);

export interface Worktree {
  path: string;
  head: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  main: boolean;
  locked?: boolean;
  createdAt?: number;
}

export type AddWorktreeOptions =
  | {
      path: string;
      branch: string;
    }
  | {
      path: string;
      newBranch: string;
      baseRef: string;
    };

export async function listWorktrees(repositoryPath: string): Promise<Worktree[]> {
  const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], {
    cwd: repositoryPath,
  });
  const worktrees = parsePorcelain(stdout);
  const creationTimes = await worktreeCreationTimes(await getCommonDir(repositoryPath));

  return worktrees.map((worktree) => {
    const createdAt = creationTimes.get(path.normalize(worktree.path));
    return createdAt === undefined ? worktree : { ...worktree, createdAt };
  });
}

export async function listBranches(repositoryPath: string): Promise<string[]> {
  const { stdout } = await exec(
    'git',
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
    { cwd: repositoryPath },
  );
  return parseBranchRefs(stdout);
}

export async function addWorktree(
  repositoryPath: string,
  options: AddWorktreeOptions,
): Promise<void> {
  let args: string[];
  if ('newBranch' in options) {
    args = ['worktree', 'add', '-b', options.newBranch, options.path, options.baseRef];
  } else {
    args = ['worktree', 'add', options.path, options.branch];
  }

  await exec('git', args, { cwd: repositoryPath });
}

export async function removeWorktree(
  repositoryPath: string,
  worktreePath: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const args = ['worktree', 'remove'];
  if (options.force) args.push('--force');
  args.push(worktreePath);
  await exec('git', args, { cwd: repositoryPath });
}

export async function deleteBranch(
  repositoryPath: string,
  branchName: string,
  options: { force?: boolean } = {},
): Promise<void> {
  await exec('git', ['branch', options.force ? '-D' : '-d', branchName], {
    cwd: repositoryPath,
  });
}

export async function readBranchTip(
  repositoryPath: string,
  branchName: string,
): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], {
    cwd: repositoryPath,
  });
  return stdout.trim();
}

export interface WorktreeStatus {
  hasChanges: boolean;
  hasUnpushedCommits: boolean;
}

export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
  const { stdout: statusStdout } = await exec('git', ['status', '--porcelain'], {
    cwd: worktreePath,
  });

  let hasUnpushedCommits = false;
  try {
    const { stdout } = await exec('git', ['rev-list', '--count', '@{u}..HEAD'], {
      cwd: worktreePath,
    });
    hasUnpushedCommits = Number(stdout.trim()) > 0;
  } catch {
    hasUnpushedCommits = false;
  }

  return {
    hasChanges: statusStdout.trim().length > 0,
    hasUnpushedCommits,
  };
}

export async function getCommonDir(worktreePath: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--git-common-dir'], {
    cwd: worktreePath,
  });
  const commonDir = stdout.trim();
  const absoluteCommonDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(worktreePath, commonDir);
  return path.normalize(absoluteCommonDir);
}

/**
 * Like {@link getCommonDir} but returns null instead of throwing when the path
 * is not a git worktree (or no longer exists). Lets non-git workspace folders
 * coexist with Deck-managed roots without breaking switching or activation.
 */
export async function getCommonDirSafe(worktreePath: string): Promise<string | null> {
  try {
    return await getCommonDir(worktreePath);
  } catch {
    return null;
  }
}

export function parsePorcelain(input: string): Worktree[] {
  const out: Worktree[] = [];
  let current: Partial<Worktree> | null = null;

  const pushCurrent = () => {
    if (!current?.path) return;

    const worktree: Worktree = {
      path: current.path,
      head: current.head ?? '',
      branch: current.branch,
      bare: current.bare ?? false,
      detached: current.detached ?? false,
      main: out.length === 0,
    };
    if (current.locked) worktree.locked = true;
    out.push(worktree);
  };

  for (const raw of input.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') {
      pushCurrent();
      current = null;
      continue;
    }
    current ??= {};
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
    else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) current.branch = line.slice('branch refs/heads/'.length);
    else if (line === 'bare') current.bare = true;
    else if (line === 'detached') current.detached = true;
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
  }
  pushCurrent();
  return out;
}

export function parseBranchRefs(input: string): string[] {
  const seen = new Set<string>();
  const branches: string[] = [];

  for (const raw of input.split('\n')) {
    const branch = raw.trim();
    if (branch === '' || branch.endsWith('/HEAD') || seen.has(branch)) continue;
    seen.add(branch);
    branches.push(branch);
  }

  return branches;
}
