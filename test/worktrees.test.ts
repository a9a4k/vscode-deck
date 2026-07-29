import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { listWorktrees, parseBranchRefs, parsePorcelain } from '../src/git/worktrees';

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
  roots.length = 0;
});

describe('parsePorcelain', () => {
  it('marks the bare Repository entry as main instead of its first linked Worktree', () => {
    expect(
      parsePorcelain(`worktree /repo.git
bare

worktree /work/feature
HEAD abc123
branch refs/heads/feature

`),
    ).toEqual([
      {
        path: '/repo.git',
        head: '',
        branch: undefined,
        bare: true,
        detached: false,
        main: true,
      },
      {
        path: '/work/feature',
        head: 'abc123',
        branch: 'feature',
        bare: false,
        detached: false,
        main: false,
      },
    ]);
  });

  it('parses normal, detached, and bare worktree entries', () => {
    expect(
      parsePorcelain(`worktree /repo/main
HEAD abc123
branch refs/heads/main

worktree /repo/detached
HEAD def456
detached

worktree /repo/bare
HEAD 000000
bare

`),
    ).toEqual([
      {
        path: '/repo/main',
        head: 'abc123',
        branch: 'main',
        bare: false,
        detached: false,
        main: true,
      },
      {
        path: '/repo/detached',
        head: 'def456',
        branch: undefined,
        bare: false,
        detached: true,
        main: false,
      },
      {
        path: '/repo/bare',
        head: '000000',
        branch: undefined,
        bare: true,
        detached: false,
        main: false,
      },
    ]);
  });

  it('parses locked worktree entries', () => {
    expect(
      parsePorcelain(`worktree /repo/locked
HEAD abc123
branch refs/heads/feature
locked because

`),
    ).toEqual([
      {
        path: '/repo/locked',
        head: 'abc123',
        branch: 'feature',
        bare: false,
        detached: false,
        main: true,
        locked: true,
      },
    ]);
  });
});

describe('parseBranchRefs', () => {
  it('dedupes branch refs and omits remote HEAD aliases', () => {
    expect(
      parseBranchRefs(`main
feature/foo
origin/HEAD
origin/main
origin/feature/foo
feature/foo
`),
    ).toEqual(['main', 'feature/foo', 'origin/main', 'origin/feature/foo']);
  });
});

describe('listWorktrees', () => {
  it('populates linked worktree creation timestamps from reflog', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'deck-list-worktrees-')));
    roots.push(root);
    const repositoryPath = join(root, 'repo');
    await mkdir(repositoryPath);
    await git(repositoryPath, 'init');
    await git(repositoryPath, 'config', 'user.email', 'deck@example.com');
    await git(repositoryPath, 'config', 'user.name', 'Deck Test');
    await writeFile(join(repositoryPath, 'README.md'), 'hello\n');
    await git(repositoryPath, 'add', 'README.md');
    await git(repositoryPath, 'commit', '-m', 'initial');

    const worktreePath = join(root, 'feature');
    await git(repositoryPath, 'worktree', 'add', '-b', 'feature', worktreePath);

    const worktrees = await listWorktrees(repositoryPath);

    expect(worktrees.find((worktree) => worktree.path === worktreePath)?.createdAt).toEqual(expect.any(Number));
    expect(worktrees.find((worktree) => worktree.path === repositoryPath)?.createdAt).toBeUndefined();
  });
});

async function git(cwd: string, ...args: string[]) {
  return exec('git', args, { cwd });
}
