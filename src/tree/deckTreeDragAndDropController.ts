import * as vscode from 'vscode';
import type { BookmarkStore } from '../bookmark/bookmarkStore';
import { getCommonDirSafe, listWorktrees } from '../git/worktrees';
import {
  ActiveWorktreeStoreLike,
  DetachedOpenerLike,
  registerRepositorySeed,
  showRepositoryPostAddPrompt,
  SwitcherLike,
} from '../repository/registerRepositorySeed';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
} from '../repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../repository/repositoryRegistryStore';
import { TerminalOrderStore } from '../terminal/terminalOrderStore';
import type { TmuxSession } from '../terminal/tmuxCli';
import { terminalSessionPrefix } from '../terminal/tmuxSafe';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { reconcileRowOrder } from './reconcileRowOrder';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
import { discoverySeedsFromDrop } from './discoverySeedsFromDrop';
import { DropPosition, reorderArray } from './reorderArray';

const DECK_TREE_MIME = 'application/vnd.code.tree.deck.repositories';
const URI_LIST_MIME = 'text/uri-list';

type RowDragPayload = {
  kind: 'row';
  rowKind: 'terminal' | 'bookmark';
  sourceKey: string;
  worktreePath: string;
};

type DragPayload =
  | {
      kind: 'repository';
      sourcePath: string;
    }
  | {
      kind: 'worktree';
      sourcePath: string;
      repositoryPath: string;
    }
  | RowDragPayload;

interface DeckNodeLike {
  contextValue?: string;
  repositoryPath?: string;
  worktree?: {
    path: string;
  };
  worktreePath?: string;
  terminal?: {
    sessionName: string;
  };
  bookmark?: {
    url: string;
  };
}

interface RepositoryNodeLike extends DeckNodeLike {
  repositoryPath: string;
}

interface WorktreeNodeLike extends DeckNodeLike {
  repositoryPath: string;
  worktree: {
    path: string;
  };
}

interface TerminalNodeLike extends DeckNodeLike {
  repositoryPath: string;
  worktreePath: string;
  terminal: {
    sessionName: string;
  };
}

interface BookmarkNodeLike extends DeckNodeLike {
  repositoryPath: string;
  worktreePath: string;
  bookmark: {
    url: string;
  };
}

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

export type TreeRefreshScope =
  | { repositoryPath: string; worktreePath?: never }
  | { worktreePath: string; repositoryPath?: never };

export class DeckTreeDragAndDropController
  implements vscode.TreeDragAndDropController<DeckNodeLike>
{
  readonly dragMimeTypes = [DECK_TREE_MIME];
  readonly dropMimeTypes = [DECK_TREE_MIME, URI_LIST_MIME];

  constructor(
    private readonly refresh: (scope?: TreeRefreshScope) => void,
    private readonly repositoryRegistry: Pick<RepositoryRegistryStore, 'list' | 'append' | 'replace'>,
    private readonly worktreeOrders: WorktreeOrderStore,
    private readonly terminalOrders: Pick<TerminalOrderStore, 'get' | 'set'>,
    private readonly tmux: TerminalSessionLister,
    private readonly bookmarks: Pick<BookmarkStore, 'list' | 'move'>,
    private readonly activeWorktrees?: ActiveWorktreeStoreLike,
    private readonly switcher?: SwitcherLike,
    private readonly detachedOpener?: DetachedOpenerLike,
    private readonly reveal?: (repositoryPath: string) => Promise<void>,
    private readonly repositoryCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
  ) {}

  handleDrag(
    source: readonly DeckNodeLike[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const [node] = source;
    if (!node) return;

    const payload = toPayload(node);
    if (!payload) return;

    dataTransfer.set(DECK_TREE_MIME, new vscode.DataTransferItem(payload));
  }

  async handleDrop(
    target: DeckNodeLike | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    // An internal drag always carries our own MIME — and VS Code *also*
    // auto-adds a `text/uri-list` entry for any node with a `resourceUri` (used
    // for the agent-status decorations). Check our payload first so internal
    // reorders aren't misrouted into the external register-a-Repository path.
    const payload = dataTransfer.get(DECK_TREE_MIME)?.value as DragPayload | undefined;
    if (!payload) {
      const uriList = dataTransfer.get(URI_LIST_MIME)?.value;
      if (typeof uriList === 'string') await this.dropRepositorySeeds(uriList);
      return;
    }

    if (payload.kind === 'worktree') {
      if (!target) return;
      await this.dropWorktree(payload, target);
      return;
    }

    if (payload.kind === 'row') {
      if (!target) return;
      await this.dropRow(payload, target);
      return;
    }

    if (!target || !isRepositoryNode(target)) return;

    const repositories = this.repositoryRegistry.list();
    const position = dropPosition(repositories, payload.sourcePath, target.repositoryPath);
    const reordered = reorderArray(
      repositories,
      payload.sourcePath,
      target.repositoryPath,
      position,
    );

    if (sameOrder(repositories, reordered)) return;

    await this.repositoryRegistry.replace(reordered);
    this.refresh();
  }

  private async dropRepositorySeeds(uriList: string): Promise<void> {
    const { activeWorktrees, detachedOpener, reveal, switcher } = this;
    if (!activeWorktrees || !switcher || !detachedOpener || !reveal) return;

    const seedPaths = await discoverySeedsFromDrop(uriList);
    if (seedPaths.length === 0) return;

    const registerSeed = (
      seedPath: string,
      revealRepository: (repositoryPath: string) => Promise<void>,
    ) =>
      registerRepositorySeed({
        seedPath,
        registry: this.repositoryRegistry,
        activeWorktrees,
        refresh: this.refresh,
        reveal: revealRepository,
        repositoryCommonDirCache: this.repositoryCommonDirCache,
      });

    if (seedPaths.length === 1) {
      const [seedPath] = seedPaths;
      const result = await registerSeed(seedPath, reveal);
      if (result.kind === 'registered') {
        await showRepositoryPostAddPrompt(seedPath, switcher, detachedOpener);
      }
      return;
    }

    let lastRegisteredPath: string | undefined;
    for (const seedPath of seedPaths) {
      await registerSeed(seedPath, async (repositoryPath) => {
        lastRegisteredPath = repositoryPath;
      });
    }
    if (lastRegisteredPath) await reveal(lastRegisteredPath);
  }

  private async dropWorktree(
    payload: Extract<DragPayload, { kind: 'worktree' }>,
    target: DeckNodeLike,
  ): Promise<void> {
    if (!isWorktreeNode(target) || payload.repositoryPath !== target.repositoryPath) return;

    const commonDir = await getCommonDirSafe(target.repositoryPath);
    if (commonDir === null) return;

    const gitWorktrees = await listWorktrees(target.repositoryPath);
    const worktrees = reconcileWorktreeOrder(
      this.worktreeOrders.get(commonDir),
      gitWorktrees,
    );
    const paths = worktrees.map((worktree) => worktree.path);
    const position = dropPosition(paths, payload.sourcePath, target.worktree.path);
    const reordered = reorderArray(paths, payload.sourcePath, target.worktree.path, position);

    if (sameOrder(paths, reordered)) return;

    await this.worktreeOrders.set(commonDir, reordered);
    this.refresh({ repositoryPath: payload.repositoryPath });
  }

  private async dropRow(
    payload: Extract<DragPayload, { kind: 'row' }>,
    target: DeckNodeLike,
  ): Promise<void> {
    let targetWorktreePath: string | undefined;
    let targetRowKey: string | undefined;
    if (isWorktreeNode(target)) {
      targetWorktreePath = target.worktree.path;
    } else if (isRowNode(target)) {
      targetWorktreePath = target.worktreePath;
      targetRowKey = rowKey(target);
    }

    if (
      payload.rowKind === 'bookmark'
      && targetWorktreePath !== undefined
      && payload.worktreePath !== targetWorktreePath
    ) {
      await this.moveBookmark(
        payload,
        targetWorktreePath,
        targetRowKey,
      );
      return;
    }

    if (!isRowNode(target) || payload.worktreePath !== target.worktreePath) return;

    const liveSessions = await this.tmux.listSessions(terminalSessionPrefix(payload.worktreePath));
    const observedRows = reconcileRowOrder(
      undefined,
      liveSessions,
      this.bookmarks.list(payload.worktreePath),
    );
    const keys = mergeObservedRowsIntoStoredOrder(
      this.terminalOrders.get(payload.worktreePath),
      observedRows,
    );
    const targetKey = rowKey(target);
    const position = dropPosition(keys, payload.sourceKey, targetKey);
    const reordered = reorderArray(
      keys,
      payload.sourceKey,
      targetKey,
      position,
    );

    if (sameOrder(keys, reordered)) return;

    await this.terminalOrders.set(payload.worktreePath, reordered);
    this.refresh({ worktreePath: payload.worktreePath });
  }

  private async moveBookmark(
    payload: RowDragPayload,
    targetWorktreePath: string,
    targetRowKey?: string,
  ): Promise<void> {
    const sourceBookmarks = this.bookmarks.list(payload.worktreePath);
    if (!sourceBookmarks.some((bookmark) => bookmark.url === payload.sourceKey)) return;

    const targetBookmarks = this.bookmarks.list(targetWorktreePath);
    const [sourceSessions, targetSessions] = await Promise.all([
      this.tmux.listSessions(terminalSessionPrefix(payload.worktreePath)),
      this.tmux.listSessions(terminalSessionPrefix(targetWorktreePath)),
    ]);
    const sourceRowOrder = mergeObservedRowsIntoStoredOrder(
      this.terminalOrders.get(payload.worktreePath),
      reconcileRowOrder(
        undefined,
        sourceSessions,
        sourceBookmarks,
      ),
    ).filter((key) => key !== payload.sourceKey);
    let targetRowOrder = mergeObservedRowsIntoStoredOrder(
      this.terminalOrders.get(targetWorktreePath),
      reconcileRowOrder(
        undefined,
        targetSessions,
        targetBookmarks,
      ),
    );
    if (!targetBookmarks.some((bookmark) => bookmark.url === payload.sourceKey)) {
      targetRowOrder.push(payload.sourceKey);
      if (targetRowKey !== undefined) {
        targetRowOrder = reorderArray(
          targetRowOrder,
          payload.sourceKey,
          targetRowKey,
          'above',
        );
      }
    }

    await this.bookmarks.move(payload.worktreePath, targetWorktreePath, payload.sourceKey);
    await this.terminalOrders.set(payload.worktreePath, sourceRowOrder);
    await this.terminalOrders.set(targetWorktreePath, targetRowOrder);
    this.refresh({ worktreePath: payload.worktreePath });
    this.refresh({ worktreePath: targetWorktreePath });
  }
}

function toPayload(node: DeckNodeLike): DragPayload | undefined {
  if (isRepositoryNode(node)) {
    return { kind: 'repository', sourcePath: node.repositoryPath };
  }
  if (isWorktreeNode(node)) {
    return {
      kind: 'worktree',
      sourcePath: node.worktree.path,
      repositoryPath: node.repositoryPath,
    };
  }
  if (isRowNode(node)) {
    return {
      kind: 'row',
      rowKind: isTerminalNode(node) ? 'terminal' : 'bookmark',
      sourceKey: rowKey(node),
      worktreePath: node.worktreePath,
    };
  }
  return undefined;
}

function isRepositoryNode(node: DeckNodeLike): node is RepositoryNodeLike {
  return (
    node.contextValue === 'deck.repository'
    && node.repositoryPath !== undefined
  );
}

function isWorktreeNode(node: DeckNodeLike): node is WorktreeNodeLike {
  return (
    node.contextValue?.startsWith('deck.worktree') === true
    && node.repositoryPath !== undefined
    && node.worktree !== undefined
  );
}

function isTerminalNode(node: DeckNodeLike): node is TerminalNodeLike {
  return (
    node.contextValue?.startsWith('deck.terminal') === true
    && node.repositoryPath !== undefined
    && node.worktreePath !== undefined
    && node.terminal !== undefined
  );
}

function isBookmarkNode(node: DeckNodeLike): node is BookmarkNodeLike {
  return (
    node.contextValue === 'deck.bookmark'
    && node.repositoryPath !== undefined
    && node.worktreePath !== undefined
    && node.bookmark !== undefined
  );
}

function isRowNode(node: DeckNodeLike): node is TerminalNodeLike | BookmarkNodeLike {
  return isTerminalNode(node) || isBookmarkNode(node);
}

function rowKey(node: TerminalNodeLike | BookmarkNodeLike): string {
  return isTerminalNode(node) ? node.terminal.sessionName : node.bookmark.url;
}

function dropPosition(
  paths: readonly string[],
  sourcePath: string,
  targetPath: string,
): DropPosition {
  return paths.indexOf(sourcePath) < paths.indexOf(targetPath) ? 'below' : 'above';
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function mergeObservedRowsIntoStoredOrder(
  storedOrder: readonly string[] | undefined,
  observedRows: readonly { key: string }[],
): string[] {
  const rowOrder = [...(storedOrder ?? [])];
  const includedKeys = new Set(rowOrder);
  for (const row of observedRows) {
    if (includedKeys.has(row.key)) continue;
    rowOrder.push(row.key);
    includedKeys.add(row.key);
  }
  return rowOrder;
}
