import { describe, expect, it, vi } from 'vitest';
import { BookmarkOpener } from '../src/bookmark/bookmarkOpener';

const bookmark = { bookmark: { url: 'https://github.com/org/repo/pull/187' } };

describe('BookmarkOpener', () => {
  it('opens a Bookmark in the Integrated Browser and reuses its URL', async () => {
    const runner = {
      getCommands: vi.fn(async () => ['workbench.action.browser.open']),
      executeCommand: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => true),
    };

    await new BookmarkOpener(runner).open(bookmark);

    expect(runner.executeCommand).toHaveBeenCalledWith('workbench.action.browser.open', {
      url: bookmark.bookmark.url,
      reuseUrlFilter: bookmark.bookmark.url,
    });
    expect(runner.openExternal).not.toHaveBeenCalled();
  });

  it('falls back to the default browser when the Integrated Browser is unavailable', async () => {
    const runner = {
      getCommands: vi.fn(async () => []),
      executeCommand: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => true),
    };

    await new BookmarkOpener(runner).open(bookmark);

    expect(runner.openExternal).toHaveBeenCalledWith(bookmark.bookmark.url);
    expect(runner.executeCommand).not.toHaveBeenCalled();
  });

  it('opens the inline action in the default browser regardless of Integrated Browser availability', async () => {
    const runner = {
      getCommands: vi.fn(async () => ['workbench.action.browser.open']),
      executeCommand: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => true),
    };

    await new BookmarkOpener(runner).openInDefaultBrowser(bookmark);

    expect(runner.openExternal).toHaveBeenCalledWith(bookmark.bookmark.url);
    expect(runner.getCommands).not.toHaveBeenCalled();
    expect(runner.executeCommand).not.toHaveBeenCalled();
  });
});
