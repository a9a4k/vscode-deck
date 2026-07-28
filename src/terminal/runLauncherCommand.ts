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
  wakePoll?: () => void;
  focusTerminal?: (sessionName: string) => void;
  sessionUriCodec?: SessionUriCodec;
  resolveLaunchers?: (
    worktreePath: string,
    userLauncherConfig: unknown,
    repositoryLauncherConfig: unknown,
  ) => Promise<LauncherGroups>;
  resolveCommonDir?: (repositoryPath: string) => Promise<string | null>;
  beforeCreate?: () => Promise<void>;
}

export class RunLauncherCommand {
  private readonly wakePoll: () => void;
  private readonly focusTerminal: (sessionName: string) => void;
  private readonly sessionUriCodec: SessionUriCodec;
  private readonly resolveLaunchers: (
    worktreePath: string,
    userLauncherConfig: unknown,
    repositoryLauncherConfig: unknown,
  ) => Promise<LauncherGroups>;
  private readonly beforeCreate: () => Promise<void>;

  constructor(
    private readonly tmux: RunLauncherTmuxCli,
    options: RunLauncherCommandOptions = {},
  ) {
    this.wakePoll = options.wakePoll ?? (() => undefined);
    this.focusTerminal = options.focusTerminal ?? (() => undefined);
    this.sessionUriCodec = options.sessionUriCodec ?? new SessionUriCodec();
    this.resolveLaunchers = options.resolveLaunchers ?? ((worktreePath, userLaunchers, repositoryLaunchers) =>
      resolveLauncherGroups(worktreePath, userLaunchers, repositoryLaunchers, {
        resolveCommonDir: options.resolveCommonDir,
      }));
    this.beforeCreate = options.beforeCreate ?? (() => Promise.resolve());
  }

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const userLaunchers = vscode.workspace.getConfiguration('deck').get('terminalLaunchers', []);
    const repositoryLaunchers = vscode.workspace.getConfiguration('deck').get('repositoryLaunchers', []);
    const groups = await this.resolveLaunchers(node.worktree.path, userLaunchers, repositoryLaunchers);
    const picked = await vscode.window.showQuickPick(toQuickPickItems(groups), {
      placeHolder: 'Run Terminal Launcher',
    });
    if (!picked) return;
    if (picked.configure) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'deck.repositoryLaunchers');
      return;
    }
    if (!picked.launcher) return;

    await this.beforeCreate();
    const session = await createAndOpenTerminal(
      this.tmux,
      node,
      this.sessionUriCodec,
      this.focusTerminal,
    );
    await this.tmux.sendCommandLine(session, picked.launcher.command);
    this.wakePoll();
  }
}

function toQuickPickItems(groups: LauncherGroups): LauncherQuickPickItem[] {
  if (!hasLaunchers(groups)) {
    return [{ label: 'No launchers configured — Configure…', configure: true }];
  }

  return [
    ...groupItems('This repository (shared)', groups.repo),
    ...groupItems('This repository (personal)', groups.repositoryLocal),
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
