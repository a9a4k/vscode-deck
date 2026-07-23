import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
  },
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDirSafe: vi.fn(async (worktreePath: string) => {
    if (worktreePath.startsWith('/repo')) return '/git/repo';
    if (worktreePath.startsWith('/other')) return '/git/other';
    return null;
  }),
}));

import * as vscode from 'vscode';
import { AddRepositoryCommand } from '../src/repository/addRepositoryCommand';

function createCommand(repositories: string[] = []) {
  const picker = { pick: vi.fn(async () => '/repo/main') };
  const registry = {
    list: vi.fn(() => repositories),
    append: vi.fn(async (repositoryPath: string) => {
      repositories.push(repositoryPath);
    }),
  };
  const activeWorktrees = { set: vi.fn(async () => undefined) };
  const switcher = { switchTo: vi.fn(async () => undefined) };
  const detachedOpener = { open: vi.fn(async () => undefined) };
  const refresh = vi.fn();
  const reveal = vi.fn(async () => undefined);

  return {
    activeWorktrees,
    command: new AddRepositoryCommand(
      picker,
      registry,
      activeWorktrees,
      switcher,
      detachedOpener,
      refresh,
      reveal,
    ),
    detachedOpener,
    picker,
    refresh,
    registry,
    reveal,
    switcher,
  };
}

describe('AddRepositoryCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('registers a git folder, reveals it, and shows post-add actions', async () => {
    const { activeWorktrees, command, refresh, registry, reveal } = createCommand();

    await command.run();

    expect(registry.append).toHaveBeenCalledWith('/repo/main');
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/repo', '/repo/main');
    expect(refresh).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith('/repo/main');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Added repository main.',
      'Switch',
      'Open in New Window',
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('switches to the Repository when the post-add Switch action is picked', async () => {
    const { command, detachedOpener, switcher } = createCommand();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Switch');

    await command.run();

    expect(switcher.switchTo).toHaveBeenCalledWith('/repo/main');
    expect(detachedOpener.open).not.toHaveBeenCalled();
  });

  it('opens the Repository in a new window when that post-add action is picked', async () => {
    const { command, detachedOpener, switcher } = createCommand();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Open in New Window');

    await command.run();

    expect(detachedOpener.open).toHaveBeenCalledWith('/repo/main');
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('does not switch or open when the post-add toast is dismissed', async () => {
    const { command, detachedOpener, switcher } = createCommand();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await command.run();

    expect(switcher.switchTo).not.toHaveBeenCalled();
    expect(detachedOpener.open).not.toHaveBeenCalled();
  });

  it.each([['Switch'], ['Open in New Window'], [undefined]])(
    'refreshes and reveals after successful registration when post-add action is %s',
    async (postAddAction) => {
      const { command, refresh, reveal } = createCommand();
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(async () => {
        expect(refresh).toHaveBeenCalledOnce();
        expect(reveal).toHaveBeenCalledWith('/repo/main');
        return postAddAction;
      });

      await command.run();

      expect(refresh).toHaveBeenCalledOnce();
      expect(reveal).toHaveBeenCalledWith('/repo/main');
    },
  );

  it('skips append for a duplicate common-dir but still reveals it and offers post-add actions', async () => {
    const { activeWorktrees, command, refresh, registry, reveal } = createCommand(['/repo/other']);

    await command.run();

    expect(registry.append).not.toHaveBeenCalled();
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/repo', '/repo/main');
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledWith('/repo/main');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Added repository main.',
      'Switch',
      'Open in New Window',
    );
  });

  it('shows an error and stops when the picked folder is not a git repo', async () => {
    const { activeWorktrees, command, picker, refresh, registry, reveal } = createCommand();
    picker.pick.mockResolvedValue('/not-git');

    await command.run();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot add /not-git: not a git repository.',
    );
    expect(registry.append).not.toHaveBeenCalled();
    expect(activeWorktrees.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
