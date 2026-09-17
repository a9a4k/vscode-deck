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
  reveal(): void;
}

interface TerminalEditorPanelRegistryLike {
  panelFor(sessionName: string): TerminalEditorPanelLike | undefined;
  focusTerminal(sessionName: string): void;
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

    // A Terminal is a typing surface: opening one focuses it per ADR-0008 §7.
    // The explicit request also covers re-clicking an already-active tab,
    // which emits no view-state change.
    const existing = this.options.terminalPanels?.panelFor(node.terminal.sessionName);
    if (existing) {
      existing.reveal();
      this.options.terminalPanels?.focusTerminal(node.terminal.sessionName);
      return;
    }

    const cwd = node.worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    const term = terminalSessionNumber(cwd, node.terminal.sessionName);
    if (!term) return;

    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ worktreePath: cwd, term }),
      terminalEditorViewType,
      { viewColumn: vscode.ViewColumn.Active },
    );
    this.options.terminalPanels?.focusTerminal(node.terminal.sessionName);
  }
}
