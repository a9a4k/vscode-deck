import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoLaunchers } from '../src/launchers/repoLaunchers';

describe('readRepoLaunchers', () => {
  it('returns an empty list when the repository launchers file is missing', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'deck-launchers-'));

    await expect(readRepoLaunchers(worktreePath)).resolves.toEqual([]);
  });

  it('returns an empty list when the repository launchers file is malformed', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'deck-launchers-'));
    await mkdir(join(worktreePath, '.deck'));
    await writeFile(join(worktreePath, '.deck', 'launchers.json'), '{ nope', 'utf8');

    await expect(readRepoLaunchers(worktreePath)).resolves.toEqual([]);
  });

  it('parses repository launchers from .deck/launchers.json', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'deck-launchers-'));
    await mkdir(join(worktreePath, '.deck'));
    await writeFile(
      join(worktreePath, '.deck', 'launchers.json'),
      JSON.stringify([{ label: 'Test', command: 'npm test' }]),
      'utf8',
    );

    await expect(readRepoLaunchers(worktreePath)).resolves.toEqual([
      { label: 'Test', command: 'npm test' },
    ]);
  });
});
