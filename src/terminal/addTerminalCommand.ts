import * as vscode from 'vscode';
import {
  allocateTermN,
  terminalSessionName,
  terminalSessionPrefix,
} from './tmuxSafe';
import type { TmuxSession } from './tmuxCli';
import { SessionUriCodec } from './sessionUriCodec';
import type { TerminalOrderStore } from './terminalOrderStore';
import type { BookmarkStore } from '../bookmark/bookmarkStore';
import { appendObservedRowsToStoredOrder } from '../tree/appendObservedRowsToStoredOrder';
import { reconcileRowOrder } from '../tree/reconcileRowOrder';

export interface AddTerminalTmuxCli {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
  ensureSession(session: string, cwd: string): Promise<void>;
}

export interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

export async function createAndOpenTerminal(
  tmux: AddTerminalTmuxCli,
  node: WorktreeNodeLike,
  terminalOrders: Pick<TerminalOrderStore, 'get' | 'set'>,
  bookmarks: Pick<BookmarkStore, 'list'>,
  sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  focusTerminal: (sessionName: string) => void = () => undefined,
): Promise<string> {
  const { session, term, existing } = await createTerminal(tmux, node);
  const worktreePath = node.worktree.path;
  const observedRows = reconcileRowOrder(undefined, existing, bookmarks.list(worktreePath));
  const rowOrder = appendObservedRowsToStoredOrder(
    terminalOrders.get(worktreePath),
    observedRows,
  ).filter((key) => key !== session);
  rowOrder.push(session);
  await terminalOrders.set(worktreePath, rowOrder);

  await vscode.commands.executeCommand(
    'vscode.openWith',
    sessionUriCodec.encode({ worktreePath, term }),
    'deck.terminal',
    { viewColumn: vscode.ViewColumn.Active },
  );
  focusTerminal(session);
  return session;
}

export async function createHeadlessTerminal(
  tmux: AddTerminalTmuxCli,
  node: WorktreeNodeLike,
): Promise<{ session: string; term: number }> {
  const { session, term } = await createTerminal(tmux, node);
  return { session, term };
}

async function createTerminal(
  tmux: AddTerminalTmuxCli,
  node: WorktreeNodeLike,
): Promise<{ session: string; term: number; existing: TmuxSession[] }> {
  const prefix = terminalSessionPrefix(node.worktree.path);
  const existing = await tmux.listSessions(prefix);
  const term = allocateTermN(node.worktree.path, existing.map((session) => session.sessionName));
  const session = terminalSessionName(node.worktree.path, term);
  await tmux.ensureSession(session, node.worktree.path);

  return { session, term, existing };
}

export class AddTerminalCommand {
  constructor(
    private readonly tmux: AddTerminalTmuxCli,
    private readonly terminalOrders: Pick<TerminalOrderStore, 'get' | 'set'>,
    private readonly bookmarks: Pick<BookmarkStore, 'list'>,
    private readonly wakePoll: () => void = () => undefined,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
    // Awaited before creating a terminal. If the DeckSocket died, this restores
    // the existing TerminalSnapshot first, so a `+` right after a server death
    // adds the new terminal alongside the restored ones instead of starting a
    // lone blank server that the next save would write over the good snapshot.
    private readonly beforeCreate: () => Promise<void> = () => Promise.resolve(),
    private readonly focusTerminal: (sessionName: string) => void = () => undefined,
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    await this.beforeCreate();
    await createAndOpenTerminal(
      this.tmux,
      node,
      this.terminalOrders,
      this.bookmarks,
      this.sessionUriCodec,
      this.focusTerminal,
    );
    this.wakePoll();
  }
}
