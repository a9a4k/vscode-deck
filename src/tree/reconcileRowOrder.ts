export type OrderedRow<Terminal, Bookmark> =
  | { kind: 'terminal'; key: string; terminal: Terminal }
  | { kind: 'bookmark'; key: string; bookmark: Bookmark };

export function reconcileRowOrder<
  Terminal extends { sessionName: string },
  Bookmark extends { url: string },
>(
  storedOrder: readonly string[] | undefined,
  liveTerminals: readonly Terminal[],
  bookmarks: readonly Bookmark[],
): readonly OrderedRow<Terminal, Bookmark>[] {
  const terminals = [...liveTerminals].sort(
    (left, right) => terminalNumber(left.sessionName) - terminalNumber(right.sessionName),
  );
  const terminalsByKey = new Map(terminals.map((terminal) => [terminal.sessionName, terminal]));
  const bookmarksByKey = new Map(bookmarks.map((bookmark) => [bookmark.url, bookmark]));
  const emittedTerminals = new Set<string>();
  const emittedBookmarks = new Set<string>();
  const rows: OrderedRow<Terminal, Bookmark>[] = [];

  for (const key of storedOrder ?? []) {
    const terminal = terminalsByKey.get(key);
    if (terminal) {
      rows.push({ kind: 'terminal', key, terminal });
      emittedTerminals.add(key);
      continue;
    }

    const bookmark = bookmarksByKey.get(key);
    if (bookmark) {
      rows.push({ kind: 'bookmark', key, bookmark });
      emittedBookmarks.add(key);
    }
  }

  for (const terminal of terminals) {
    if (!emittedTerminals.has(terminal.sessionName)) {
      rows.push({ kind: 'terminal', key: terminal.sessionName, terminal });
    }
  }

  for (const bookmark of bookmarks) {
    if (!emittedBookmarks.has(bookmark.url)) {
      rows.push({ kind: 'bookmark', key: bookmark.url, bookmark });
    }
  }

  return rows;
}

function terminalNumber(sessionName: string): number {
  return Number(sessionName.match(/__term-(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}
