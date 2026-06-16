import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDir,
} from '../repository/repositoryCommonDirCache';
import {
  addWorktree,
  listBranches,
  type AddWorktreeOptions,
  type Worktree,
} from '../git/worktrees';
import { branchWorktreeName, defaultWorktreePath } from './defaultWorktreePath';

const CREATE_BRANCH_LABEL = 'Create new branch...';
const SWITCH_LABEL = 'Switch';
const OPEN_IN_NEW_WINDOW_LABEL = 'Open in New Window';

interface RepositoryNodeLike {
  repositoryPath: string;
}

interface SwitcherLike {
  switchTo(targetPath: string): Promise<void>;
}

interface DetachedOpenerLike {
  open(targetPath: string): Promise<void>;
}

interface WorktreeRootStoreLike {
  get(commonDir: string): string | undefined;
  set(commonDir: string, rootPath: string): Promise<void>;
}

interface WorktreeListCacheLike {
  add(commonDir: string, worktree: Worktree): Promise<void>;
}

interface WorktreeRequest {
  path: string;
  branch: string;
  add: AddWorktreeOptions;
}

type BranchPick = vscode.QuickPickItem &
  (
    | {
        action: 'create';
      }
    | {
        action: 'existing';
        branch: string;
      }
  );

export class AddWorktreeCommand {
  constructor(
    private readonly switcher: SwitcherLike,
    private readonly detachedOpener: DetachedOpenerLike,
    private readonly refresh: () => void,
    private readonly worktreeRoots: WorktreeRootStoreLike = {
      get: () => undefined,
      set: async () => undefined,
    },
    private readonly worktreeListCache: WorktreeListCacheLike = {
      add: async () => undefined,
    },
    private readonly repositoryCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
  ) {}

  async run(node: RepositoryNodeLike | undefined): Promise<void> {
    if (!node) return;

    const branches = await listBranches(node.repositoryPath);
    const picked = await vscode.window.showQuickPick(this.branchPicks(branches), {
      placeHolder: 'Select branch',
    });
    if (!picked) return;

    const commonDir = await resolveCommonDir(this.repositoryCommonDirCache, node.repositoryPath);
    const rememberedRoot = this.worktreeRoots.get(commonDir);
    let request: WorktreeRequest | undefined;
    if (picked.action === 'create') {
      request = await this.newBranchRequest(node.repositoryPath, rememberedRoot, branches);
    } else {
      request = await this.existingBranchRequest(node.repositoryPath, rememberedRoot, picked.branch);
    }
    if (!request) return;

    try {
      await addWorktree(node.repositoryPath, request.add);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot create worktree: ${errorMessage(error)}`);
      return;
    }

    await this.worktreeRoots.set(commonDir, path.dirname(request.path));
    await this.worktreeListCache.add(commonDir, {
      path: request.path,
      head: '',
      bare: false,
      detached: false,
      branch: request.branch,
    });
    this.refresh();

    const postCreateAction = await vscode.window.showInformationMessage(
      `Created worktree ${request.branch}.`,
      SWITCH_LABEL,
      OPEN_IN_NEW_WINDOW_LABEL,
    );
    if (postCreateAction === SWITCH_LABEL) {
      await this.switcher.switchTo(request.path);
    } else if (postCreateAction === OPEN_IN_NEW_WINDOW_LABEL) {
      await this.detachedOpener.open(request.path);
    }
  }

  private branchPicks(branches: string[]): BranchPick[] {
    return [
      {
        label: CREATE_BRANCH_LABEL,
        action: 'create',
      },
      ...branches.map(
        (branch): BranchPick => ({
          label: branch,
          action: 'existing',
          branch,
        }),
      ),
    ];
  }

  private async existingBranchRequest(
    repositoryPath: string,
    rememberedRoot: string | undefined,
    branch: string,
  ): Promise<WorktreeRequest | undefined> {
    const targetPath = await this.promptForPath(repositoryPath, branch, rememberedRoot);
    if (!targetPath) return undefined;
    return {
      path: targetPath,
      branch,
      add: {
        path: targetPath,
        branch,
      },
    };
  }

  private async newBranchRequest(
    repositoryPath: string,
    rememberedRoot: string | undefined,
    branches: string[],
  ): Promise<WorktreeRequest | undefined> {
    const newBranch = (await vscode.window.showInputBox({ prompt: 'New branch name' }))?.trim();
    if (!newBranch) return undefined;

    const baseRef = (
      await vscode.window.showInputBox({
        prompt: 'Base ref',
        value: defaultBaseRef(branches),
      })
    )?.trim();
    if (!baseRef) return undefined;

    const targetPath = await this.promptForPath(repositoryPath, newBranch, rememberedRoot);
    if (!targetPath) return undefined;

    return {
      path: targetPath,
      branch: newBranch,
      add: {
        path: targetPath,
        newBranch,
        baseRef,
      },
    };
  }

  private async promptForPath(
    repositoryPath: string,
    branch: string,
    rememberedRoot: string | undefined,
  ): Promise<string | undefined> {
    const input = vscode.window.createInputBox();
    const worktreeName = branchWorktreeName(branch);
    const rootPickerButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('folder'),
      tooltip: 'Choose worktree root',
    };

    input.prompt = 'Worktree path';
    input.value = defaultWorktreePath(repositoryPath, branch, rememberedRoot);
    input.buttons = [rootPickerButton];

    return new Promise((resolve) => {
      let settled = false;
      const disposables: vscode.Disposable[] = [];
      const settle = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        for (const disposable of disposables) disposable.dispose();
        input.dispose();
        resolve(value);
      };

      disposables.push(
        input.onDidAccept(() => {
          const targetPath = input.value.trim();
          settle(targetPath || undefined);
          input.hide();
        }),
        input.onDidHide(() => {
          settle(undefined);
        }),
        input.onDidTriggerButton(async (button) => {
          if (button !== rootPickerButton) return;
          const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(
              rememberedRoot ?? path.dirname(path.normalize(repositoryPath)),
            ),
          });
          if (!picked || picked.length === 0) return;
          input.value = path.join(picked[0].fsPath, worktreeName);
        }),
      );

      input.show();
    });
  }
}

function defaultBaseRef(branches: string[]): string {
  for (const name of ['main', 'master']) {
    const origin = branches.find((branch) => branch === `origin/${name}`);
    if (origin) return origin;

    const remote = branches.find((branch) => branch.endsWith(`/${name}`));
    if (remote) return remote;

    const local = branches.find((branch) => branch === name);
    if (local) return local;
  }

  return branches[0] ?? 'HEAD';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderrValue = error.stderr;
    const stderr = typeof stderrValue === 'string' ? stderrValue.trim() : '';
    if (stderr) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
