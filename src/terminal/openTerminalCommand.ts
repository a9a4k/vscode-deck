import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';
import { terminalSessionNumber } from './tmuxSafe';

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
    windowName: string;
  };
  worktreePath?: string;
}

interface TerminalEditorPanelLike {
  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
}

interface TerminalEditorPanelRegistryLike {
  panelFor(sessionName: string): TerminalEditorPanelLike | undefined;
  preserveFocusOnNextActivation(sessionName: string): void;
}

interface OpenTerminalCommandOptions {
  terminalPanels?: TerminalEditorPanelRegistryLike;
}

export class OpenTerminalCommand {
  constructor(
    private readonly options: OpenTerminalCommandOptions = {},
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    // Single-click reveals the Terminal but keeps focus on the tree, like the
    // Explorer opening a file in preview — so cmd+backspace deletes the row.
    // Clicking into the Terminal focuses it for typing.
    const existing = this.options.terminalPanels?.panelFor(node.terminal.sessionName);
    if (existing) {
      this.options.terminalPanels?.preserveFocusOnNextActivation(node.terminal.sessionName);
      existing.reveal(undefined, true);
      return;
    }

    const cwd = node.worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    const term = terminalSessionNumber(cwd, node.terminal.sessionName);
    if (!term) return;

    this.options.terminalPanels?.preserveFocusOnNextActivation(node.terminal.sessionName);
    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ worktreePath: cwd, term }),
      terminalEditorViewType,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    );
  }
}
