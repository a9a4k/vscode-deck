import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  ThemeIcon: vi.fn(function ThemeIcon(this: { id: string }, id: string) {
    this.id = id;
  }),
  Uri: {
    file: vi.fn((fsPath: string) => ({ fsPath })),
  },
  window: {
    createInputBox: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showInputBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

vi.mock('../src/git/worktrees', () => ({
  addWorktree: vi.fn(async () => undefined),
  getCommonDir: vi.fn(async () => '/git/myrepo'),
  listBranches: vi.fn(async () => ['main', 'feature/foo']),
}));

import * as vscode from 'vscode';
import { addWorktree, getCommonDir, listBranches } from '../src/git/worktrees';
import { AddWorktreeCommand } from '../src/worktree/addWorktreeCommand';

interface InputBoxMock {
  value: string;
  prompt?: string;
  buttons: readonly vscode.QuickInputButton[];
  onDidAccept(listener: () => void): { dispose(): void };
  onDidHide(listener: () => void): { dispose(): void };
  onDidTriggerButton(listener: (button: vscode.QuickInputButton) => void): { dispose(): void };
  show(): void;
  hide(): void;
  dispose(): void;
  triggerButton(button: vscode.QuickInputButton): Promise<void>;
}

function createAcceptingInputBox(onShow?: (box: InputBoxMock) => Promise<void> | void): InputBoxMock {
  let accept: (() => void) | undefined;
  let hide: (() => void) | undefined;
  let triggerButton: ((button: vscode.QuickInputButton) => Promise<void> | void) | undefined;
  const box: InputBoxMock = {
    value: '',
    buttons: [],
    onDidAccept: vi.fn((listener: () => void) => {
      accept = listener;
      return { dispose: vi.fn() };
    }),
    onDidHide: vi.fn((listener: () => void) => {
      hide = listener;
      return { dispose: vi.fn() };
    }),
    onDidTriggerButton: vi.fn((listener: (button: vscode.QuickInputButton) => void) => {
      triggerButton = listener;
      return { dispose: vi.fn() };
    }),
    show: vi.fn(() => {
      queueMicrotask(async () => {
        await onShow?.(box);
        accept?.();
      });
    }),
    hide: vi.fn(() => hide?.()),
    dispose: vi.fn(),
    triggerButton: vi.fn(async (button: vscode.QuickInputButton) => {
      await triggerButton?.(button);
    }),
  };
  return box;
}

function createCommand(rootPath?: string) {
  const switcher = { switchTo: vi.fn(async () => undefined) };
  const detachedOpener = { open: vi.fn(async () => undefined) };
  const refresh = vi.fn();
  const worktreeRoots = {
    get: vi.fn(() => rootPath),
    set: vi.fn(async () => undefined),
  };
  const worktreeListCache = {
    add: vi.fn(async () => undefined),
  };
  return {
    command: new AddWorktreeCommand(
      switcher,
      detachedOpener,
      refresh,
      worktreeRoots,
      worktreeListCache,
    ),
    detachedOpener,
    refresh,
    switcher,
    worktreeListCache,
    worktreeRoots,
  };
}

function pickExistingBranch(): void {
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
    const picks = items as Array<{ branch?: string }>;
    return picks.find((item) => item.branch === 'feature/foo');
  });
}

describe('AddWorktreeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addWorktree).mockReset();
    vi.mocked(getCommonDir).mockReset();
    vi.mocked(listBranches).mockReset();
    vi.mocked(addWorktree).mockResolvedValue(undefined);
    vi.mocked(getCommonDir).mockResolvedValue('/git/myrepo');
    vi.mocked(listBranches).mockResolvedValue(['main', 'feature/foo']);
    vi.mocked(vscode.window.createInputBox).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
    vi.mocked(vscode.window.showInputBox).mockReset();
    vi.mocked(vscode.window.showOpenDialog).mockReset();
    vi.mocked(vscode.window.showQuickPick).mockReset();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('shows post-create switch options after creating an existing-branch worktree', async () => {
    const { command, refresh } = createCommand('/custom/worktrees');
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(refresh).toHaveBeenCalledOnce();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Created worktree feature/foo.',
      'Switch',
      'Open in New Window',
    );
  });

  it('switches to the new worktree when the post-create Switch action is picked', async () => {
    const { command, detachedOpener, switcher } = createCommand('/custom/worktrees');
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Switch');

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(switcher.switchTo).toHaveBeenCalledWith('/custom/worktrees/feature-foo');
    expect(detachedOpener.open).not.toHaveBeenCalled();
  });

  it('opens the new worktree in a new window when that post-create action is picked', async () => {
    const { command, detachedOpener, switcher } = createCommand('/custom/worktrees');
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Open in New Window');

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(detachedOpener.open).toHaveBeenCalledWith('/custom/worktrees/feature-foo');
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('does not switch, open, or mutate active worktree state when the post-create toast is dismissed', async () => {
    const activeWorktrees = { set: vi.fn(async () => undefined) };
    const switcher = {
      switchTo: vi.fn(async (targetPath: string) => {
        await activeWorktrees.set('/git/myrepo', targetPath);
      }),
    };
    const detachedOpener = { open: vi.fn(async () => undefined) };
    const refresh = vi.fn();
    const worktreeRoots = {
      get: vi.fn(() => '/custom/worktrees'),
      set: vi.fn(async () => undefined),
    };
    const command = new AddWorktreeCommand(switcher, detachedOpener, refresh, worktreeRoots);
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(switcher.switchTo).not.toHaveBeenCalled();
    expect(detachedOpener.open).not.toHaveBeenCalled();
    expect(activeWorktrees.set).not.toHaveBeenCalled();
  });

  it.each([['Switch'], ['Open in New Window'], [undefined]])(
    'refreshes after successful creation when post-create action is %s',
    async (postCreateAction) => {
      const { command, refresh } = createCommand('/custom/worktrees');
      const input = createAcceptingInputBox();

      pickExistingBranch();
      vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(async () => {
        expect(refresh).toHaveBeenCalledOnce();
        return postCreateAction;
      });

      await command.run({ repositoryPath: '/work/myrepo' });

      expect(refresh).toHaveBeenCalledOnce();
    },
  );

  it('creates an existing-branch worktree from the remembered root and learns the chosen root', async () => {
    const { command, switcher, worktreeRoots } = createCommand('/custom/worktrees');
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Switch');

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(listBranches).toHaveBeenCalledWith('/work/myrepo');
    expect(input.prompt).toBe('Worktree path');
    expect(input.value).toBe('/custom/worktrees/feature-foo');
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/custom/worktrees/feature-foo',
      branch: 'feature/foo',
    });
    expect(worktreeRoots.set).toHaveBeenCalledWith('/git/myrepo', '/custom/worktrees');
    expect(switcher.switchTo).toHaveBeenCalledWith('/custom/worktrees/feature-foo');
  });

  it('updates the worktree-list cache after successful creation', async () => {
    const { command, worktreeListCache } = createCommand('/custom/worktrees');
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(worktreeListCache.add).toHaveBeenCalledWith('/git/myrepo', {
      path: '/custom/worktrees/feature-foo',
      head: '',
      bare: false,
      detached: false,
      branch: 'feature/foo',
    });
  });

  it('lets the folder picker replace the parent while preserving the branch slug', async () => {
    const { command, worktreeRoots } = createCommand('/remembered/root');
    const input = createAcceptingInputBox(async (box) => {
      await box.triggerButton(box.buttons[0]);
    });

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      { fsPath: '/picked/root' } as vscode.Uri,
    ]);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(input.buttons).toEqual([
      expect.objectContaining({
        iconPath: expect.objectContaining({ id: 'folder' }),
      }),
    ]);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        canSelectFolders: true,
        canSelectFiles: false,
        defaultUri: { fsPath: '/remembered/root' },
      }),
    );
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/picked/root/feature-foo',
      branch: 'feature/foo',
    });
    expect(worktreeRoots.set).toHaveBeenCalledWith('/git/myrepo', '/picked/root');
  });

  it('keeps the input value when the folder picker is cancelled', async () => {
    const { command } = createCommand();
    const input = createAcceptingInputBox(async (box) => {
      await box.triggerButton(box.buttons[0]);
    });

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: { fsPath: '/work' },
      }),
    );
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/work/myrepo.worktrees/feature-foo',
      branch: 'feature/foo',
    });
  });

  it('does nothing when the path input is cleared', async () => {
    const { command, switcher, worktreeRoots } = createCommand('/custom/worktrees');
    const input = createAcceptingInputBox((box) => {
      box.value = '';
    });

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(addWorktree).not.toHaveBeenCalled();
    expect(worktreeRoots.set).not.toHaveBeenCalled();
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('creates a new-branch worktree from the chosen base ref', async () => {
    const { command, switcher } = createCommand();
    const input = createAcceptingInputBox();

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ action?: string }>;
      return picks.find((item) => item.action === 'create');
    });
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('feature/bar')
      .mockResolvedValueOnce('main');
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Switch');

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/work/myrepo.worktrees/feature-bar',
      newBranch: 'feature/bar',
      baseRef: 'main',
    });
    expect(switcher.switchTo).toHaveBeenCalledWith('/work/myrepo.worktrees/feature-bar');
  });

  it('defaults the base ref to origin/main', async () => {
    const { command } = createCommand();
    const input = createAcceptingInputBox();

    vi.mocked(listBranches).mockResolvedValue(['main', 'origin/main', 'feature/foo']);
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ action?: string }>;
      return picks.find((item) => item.action === 'create');
    });
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('feature/bar')
      .mockResolvedValueOnce('origin/main');
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(vscode.window.showInputBox).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ value: 'origin/main' }),
    );
  });

  it('does nothing when branch picking is cancelled', async () => {
    const { command, switcher } = createCommand();

    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(addWorktree).not.toHaveBeenCalled();
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('surfaces git failures and does not switch', async () => {
    const { command, refresh, switcher, worktreeRoots } = createCommand();
    const input = createAcceptingInputBox();

    pickExistingBranch();
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(addWorktree).mockRejectedValueOnce({ stderr: 'path already exists' });

    await command.run({ repositoryPath: '/work/myrepo' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot create worktree: path already exists',
    );
    expect(worktreeRoots.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });
});
