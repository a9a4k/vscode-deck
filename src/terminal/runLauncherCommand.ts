import * as vscode from 'vscode';
import {
  hasLaunchers,
  resolveLaunchers as resolveLauncherGroups,
  type LauncherGroups,
} from '../launchers/resolveLaunchers';
import type { TerminalLauncher } from '../launchers/terminalLaunchers';
import {
  createAndOpenTerminal,
  type AddTerminalTmuxCli,
  type WorktreeNodeLike,
} from './addTerminalCommand';
import { SessionUriCodec } from './sessionUriCodec';

interface RunLauncherTmuxCli extends AddTerminalTmuxCli {
  sendCommandLine(session: string, command: string): Promise<void>;
}

type LauncherQuickPickItem = vscode.QuickPickItem & {
  launcher?: TerminalLauncher;
  configure?: true;
};

interface RunLauncherCommandOptions {
  refresh?: () => void;
  sessionUriCodec?: SessionUriCodec;
  resolveLaunchers?: (
    worktreePath: string,
    userLauncherConfig: unknown,
  ) => Promise<LauncherGroups>;
  beforeCreate?: () => Promise<void>;
}

export class RunLauncherCommand {
  private readonly refresh: () => void;
  private readonly sessionUriCodec: SessionUriCodec;
  private readonly resolveLaunchers: (
    worktreePath: string,
    userLauncherConfig: unknown,
  ) => Promise<LauncherGroups>;
  private readonly beforeCreate: () => Promise<void>;

  constructor(
    private readonly tmux: RunLauncherTmuxCli,
    options: RunLauncherCommandOptions = {},
  ) {
    this.refresh = options.refresh ?? (() => undefined);
    this.sessionUriCodec = options.sessionUriCodec ?? new SessionUriCodec();
    this.resolveLaunchers = options.resolveLaunchers ?? resolveLauncherGroups;
    this.beforeCreate = options.beforeCreate ?? (() => Promise.resolve());
  }

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const userLaunchers = vscode.workspace.getConfiguration('deck').get('terminalLaunchers', []);
    const groups = await this.resolveLaunchers(node.worktree.path, userLaunchers);
    const picked = await vscode.window.showQuickPick(toQuickPickItems(groups), {
      placeHolder: 'Run Terminal Launcher',
    });
    if (!picked) return;
    if (picked.configure) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'deck.terminalLaunchers');
      return;
    }
    if (!picked.launcher) return;

    await this.beforeCreate();
    const session = await createAndOpenTerminal(this.tmux, node, this.sessionUriCodec);
    await this.tmux.sendCommandLine(session, picked.launcher.command);
    this.refresh();
  }
}

function toQuickPickItems(groups: LauncherGroups): LauncherQuickPickItem[] {
  if (!hasLaunchers(groups)) {
    return [{ label: 'No launchers configured — Configure…', configure: true }];
  }

  return [
    ...groupItems('This repository', groups.repo),
    ...groupItems('User', groups.user),
  ];
}

function groupItems(label: string, launchers: TerminalLauncher[]): LauncherQuickPickItem[] {
  if (launchers.length === 0) return [];

  return [
    { kind: vscode.QuickPickItemKind.Separator, label },
    ...launchers.map((launcher) => ({
      label: launcher.label,
      description: launcher.command,
      launcher,
    })),
  ];
}
