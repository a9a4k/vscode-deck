import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';

export interface TerminalRemovalTmuxCli {
  killSession(session: string): Promise<void>;
}

interface TerminalNodeLike {
  terminal?: {
    sessionName?: string;
    windowName?: string;
  };
}

export type ConfirmTerminalRemoval = (label: string) => Promise<boolean>;

export class TerminalRemovalCommand {
  constructor(
    private readonly tmux: TerminalRemovalTmuxCli,
    private readonly wakePoll: () => void = () => undefined,
    private readonly confirm: ConfirmTerminalRemoval = async () => true,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
    private readonly onSessionKilled: (sessionName: string) => Promise<void> = async () => undefined,
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    // The cmd+backspace keybinding fires for any focused Deck tree row, so a
    // non-Terminal selection (Worktree/Repository) reaches here — no-op it.
    const session = node?.terminal?.sessionName;
    if (!session) return;

    if (!(await this.confirm(node?.terminal?.windowName ?? session))) return;

    await this.tmux.killSession(session);
    await this.onSessionKilled(session);
    await this.closeMatchingEditorTab(session);
    this.wakePoll();
  }

  private async closeMatchingEditorTab(session: string): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (this.sessionForTab(tab) !== session) continue;
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }

  private sessionForTab(tab: vscode.Tab): string | undefined {
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
    if (input?.viewType !== terminalEditorViewType || !input.uri) return undefined;

    try {
      return this.sessionUriCodec.decode(input.uri).sessionName;
    } catch {
      return undefined;
    }
  }
}
