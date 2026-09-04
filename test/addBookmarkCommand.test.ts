import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  clipboardText: 'https://github.com/org/repo/pull/186',
  showInputBox: vi.fn(),
}));

vi.mock('vscode', () => ({
  env: {
    clipboard: {
      readText: vi.fn(async () => vscodeState.clipboardText),
    },
  },
  window: {
    showInputBox: vscodeState.showInputBox,
  },
}));

import { AddBookmarkCommand } from '../src/bookmark/addBookmarkCommand';
import { BookmarkStore } from '../src/bookmark/bookmarkStore';

function createCommand() {
  const values: Record<string, unknown> = {};
  const bookmarks = new BookmarkStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });
  const reveal = vi.fn(async () => undefined);
  return {
    bookmarks,
    command: new AddBookmarkCommand(bookmarks, reveal),
    reveal,
  };
}

describe('AddBookmarkCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.clipboardText = 'https://github.com/org/repo/pull/186';
    vscodeState.showInputBox.mockResolvedValue('https://github.com/org/repo/pull/186');
  });

  it('pre-fills an https URL from the clipboard, pins it, and reveals its row', async () => {
    const { bookmarks, command, reveal } = createCommand();

    await command.run({ worktree: { path: '/work/alpha' } });

    expect(vscodeState.showInputBox).toHaveBeenCalledWith(expect.objectContaining({
      value: 'https://github.com/org/repo/pull/186',
    }));
    expect(bookmarks.list('/work/alpha')).toEqual([
      { url: 'https://github.com/org/repo/pull/186' },
    ]);
    expect(reveal).toHaveBeenCalledWith(
      '/work/alpha',
      { url: 'https://github.com/org/repo/pull/186' },
    );
  });

  it('does not pre-fill the input when the clipboard does not hold an http(s) URL', async () => {
    const { command } = createCommand();
    vscodeState.clipboardText = 'git@github.com:org/repo.git';

    await command.run({ worktree: { path: '/work/alpha' } });

    expect(vscodeState.showInputBox).toHaveBeenCalledWith(expect.objectContaining({
      value: undefined,
    }));
  });

  it('pre-fills an http URL from the clipboard', async () => {
    const { command } = createCommand();
    vscodeState.clipboardText = 'http://localhost:5173/';

    await command.run({ worktree: { path: '/work/alpha' } });

    expect(vscodeState.showInputBox).toHaveBeenCalledWith(expect.objectContaining({
      value: 'http://localhost:5173/',
    }));
  });

  it('reveals the existing row when the URL is already pinned', async () => {
    const { bookmarks, command, reveal } = createCommand();
    const existing = { url: 'https://github.com/org/repo/pull/186', label: 'PR 186' };
    await bookmarks.add('/work/alpha', existing);

    await command.run({ worktree: { path: '/work/alpha' } });

    expect(reveal).toHaveBeenCalledWith('/work/alpha', existing);
  });
});
