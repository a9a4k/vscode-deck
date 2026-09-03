import type { MementoLike } from '../switch/activeWorktreeStore';

export const BOOKMARKS_KEY = 'deck.bookmarks';

export interface Bookmark {
  url: string;
  label?: string;
}

export class BookmarkStore {
  constructor(private readonly memento: MementoLike) {}

  list(worktreePath: string): Bookmark[] {
    return this.all()[worktreePath] ?? [];
  }

  async add(worktreePath: string, bookmark: Bookmark): Promise<Bookmark> {
    const bookmarks = this.list(worktreePath);
    const existing = bookmarks.find(({ url }) => url === bookmark.url);
    if (existing) return existing;

    await this.memento.update(BOOKMARKS_KEY, {
      ...this.all(),
      [worktreePath]: [...bookmarks, bookmark],
    });
    return bookmark;
  }

  async move(sourceWorktreePath: string, targetWorktreePath: string, url: string): Promise<void> {
    if (sourceWorktreePath === targetWorktreePath) return;

    const bookmark = this.list(sourceWorktreePath).find((candidate) => candidate.url === url);
    if (!bookmark) return;

    const targetBookmarks = this.list(targetWorktreePath);
    await this.memento.update(BOOKMARKS_KEY, {
      ...this.all(),
      [sourceWorktreePath]: this.list(sourceWorktreePath)
        .filter((candidate) => candidate.url !== url),
      [targetWorktreePath]: targetBookmarks.some((candidate) => candidate.url === url)
        ? targetBookmarks.map((candidate) => candidate.url === url ? bookmark : candidate)
        : [...targetBookmarks, bookmark],
    });
  }

  async remove(worktreePath: string, url: string): Promise<void> {
    await this.memento.update(BOOKMARKS_KEY, {
      ...this.all(),
      [worktreePath]: this.list(worktreePath).filter((bookmark) => bookmark.url !== url),
    });
  }

  async rename(worktreePath: string, url: string, label: string | undefined): Promise<void> {
    await this.memento.update(BOOKMARKS_KEY, {
      ...this.all(),
      [worktreePath]: this.list(worktreePath).map((bookmark) => {
        if (bookmark.url !== url) return bookmark;
        return label === undefined ? { url: bookmark.url } : { ...bookmark, label };
      }),
    });
  }

  async clear(worktreePath: string): Promise<void> {
    const all = { ...this.all() };
    delete all[worktreePath];
    await this.memento.update(BOOKMARKS_KEY, all);
  }

  private all(): Record<string, Bookmark[]> {
    return this.memento.get<Record<string, Bookmark[]>>(BOOKMARKS_KEY, {});
  }
}
