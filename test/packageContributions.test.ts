import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));

describe('package contributions', () => {
  it('does not retain legacy registry public contracts in package or source', () => {
    const files = [
      'package.json',
      ...[
        'src/extension.ts',
        'src/tree/repositoryTree.ts',
        'src/tree/deckTreeDragAndDropController.ts',
        'src/repository/repositoryRegistryStore.ts',
        'src/repository/repositoryCommonDirCache.ts',
      ],
    ];
    const oldTerm = ['pro', 'ject'].join('');
    const oldTermPlural = `${oldTerm}s`;
    const legacyContracts = [
      ['deck', oldTerm].join('.'),
      ['deck', oldTermPlural].join('.'),
      `deck.add${capitalize(oldTerm)}`,
      `deck.remove${capitalize(oldTerm)}`,
      `deck.${oldTerm}Registry`,
      `deck.${oldTerm}CommonDirCache`,
      `application/vnd.code.tree.deck.${oldTermPlural}`,
    ];

    const text = files.map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');

    for (const contract of legacyContracts) {
      expect(text).not.toContain(contract);
    }
  });

  it('contributes Deck to the secondary sidebar with first-install walkthrough', () => {
    expect(pkg.activationEvents).toEqual(['onView:deck.repositories']);
    expect(pkg.engines.vscode).toBe('^1.106.0');
    expect(pkg.contributes.viewsContainers.activitybar).toBeUndefined();
    expect(pkg.contributes.viewsContainers.secondarySidebar).toEqual([{
      id: 'deck',
      title: 'Deck',
      icon: '$(folder)',
    }]);
    expect(pkg.contributes.views.deck).toContainEqual({
      id: 'deck.repositories',
      name: 'Repositories & Worktrees',
    });
    expect(pkg.contributes.keybindings).toContainEqual({
      command: 'workbench.view.extension.deck',
      key: 'ctrl+shift+.',
      mac: 'cmd+shift+.',
    });

    expect(pkg.contributes.walkthroughs).toEqual([{
      id: 'deck.getStarted',
      title: 'Deck',
      description: 'Open Deck from the secondary sidebar.',
      steps: [{
        id: 'deck.secondarySidebar',
        title: 'Deck lives in the secondary sidebar.',
        description: 'Open the secondary sidebar, then select Deck.',
        media: { markdown: 'media/walkthroughs/secondary-sidebar.md' },
        completionEvents: ['onCommand:workbench.action.toggleAuxiliaryBar'],
      }],
    }]);

    const markdownPath = join(process.cwd(), 'media/walkthroughs/secondary-sidebar.md');
    expect(existsSync(markdownPath)).toBe(true);
    const markdown = readFileSync(markdownPath, 'utf8');
    expect(markdown).toContain('secondary sidebar');
    expect(markdown).toContain('command:workbench.action.toggleAuxiliaryBar');
  });

  it('does not expose RepositoryRegistry as a user setting', () => {
    expect(pkg.contributes.configuration?.properties?.['deck.repositories']).toBeUndefined();
  });

  it('contributes per-agent resume template settings', () => {
    expect(pkg.contributes.configuration?.properties?.['deck.agentResumeTemplates.claude']).toMatchObject({
      type: 'string',
      default: 'claude --resume {id}',
    });
    expect(pkg.contributes.configuration?.properties?.['deck.agentResumeTemplates.codex']).toMatchObject({
      type: 'string',
      default: 'codex resume {id}',
    });
  });

  it('contributes agent status notification settings', () => {
    expect(pkg.contributes.configuration?.properties?.['deck.notifyOnNeedsInput']).toMatchObject({
      type: 'boolean',
      default: true,
    });
    expect(pkg.contributes.configuration?.properties?.['deck.notifyOnCompleted']).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });

  it('contributes the curated safe automatic-rename-format setting only', () => {
    expect(pkg.contributes.configuration?.properties?.['deck.tmux.automaticRenameFormat']).toMatchObject({
      type: 'string',
      default: '',
    });
    expect(pkg.contributes.configuration?.properties?.['deck.tmuxConfig']).toBeUndefined();
  });

  it('contributes TerminalLauncher settings', () => {
    expect(pkg.contributes.configuration?.properties?.['deck.terminalLaunchers']).toMatchObject({
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          command: { type: 'string' },
        },
        required: ['command'],
      },
    });
  });

  it('does not ship node-pty or its postinstall workaround', () => {
    expect(pkg.dependencies?.['node-pty']).toBeUndefined();
    expect(pkg.devDependencies?.['node-pty']).toBeUndefined();
    expect(pkg.scripts?.postinstall).toBeUndefined();
    expect(lock.packages?.['node_modules/node-pty']).toBeUndefined();
  });

  it('contributes Deck Terminal as a custom editor for deck-terminal URIs', () => {
    expect(pkg.contributes.customEditors).toContainEqual({
      viewType: 'deck.terminal',
      displayName: 'Deck Terminal',
      selector: [{ filenamePattern: 'deck-terminal://**' }],
      priority: 'default',
    });
  });

  it('contributes Deck Terminal find command and keybindings', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.terminal.find',
      title: 'Deck Terminal: Find',
    });
    expect(pkg.contributes.keybindings).toContainEqual({
      command: 'deck.terminal.find',
      key: 'ctrl+f',
      mac: 'cmd+f',
      when: "activeCustomEditorId == 'deck.terminal'",
    });
    // Palette entry is scoped to an active Deck terminal so it does not
    // appear (and silently no-op) while editing a normal file.
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.terminal.find',
      when: "activeCustomEditorId == 'deck.terminal'",
    });
  });

  it('contributes install agent hooks as a command-palette action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.installAgentHooks',
      title: 'Deck: Install Agent Hooks',
    });
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.installAgentHooks',
    });
  });

  it('contributes remove agent hooks as a command-palette action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.removeAgentHooks',
      title: 'Deck: Uninstall Agent Hooks',
    });
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.removeAgentHooks',
    });
  });

  it('contributes add worktree as a repository-only inline tree action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.addWorktree',
      title: 'Add Worktree',
      icon: '$(add)',
    });

    expect(pkg.contributes.menus['view/item/context']).toContainEqual({
      command: 'deck.addWorktree',
      when: 'view == deck.repositories && viewItem == deck.repository',
      group: 'inline',
    });
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.addWorktree',
      when: 'false',
    });
  });

  it('contributes delete worktree only via the right-click context menu', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.removeWorktree',
      title: 'Delete Worktree…',
      icon: '$(trash)',
    });

    // Worktree row's inline slot is reserved for the Add Terminal `+` icon;
    // delete-worktree lives only in the right-click context menu.
    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.removeWorktree',
      ),
    ).toEqual([{
      command: 'deck.removeWorktree',
      when: 'view == deck.repositories && (viewItem == deck.worktree || viewItem == deck.worktree.active || viewItem == deck.worktree.main)',
      group: 'navigation@3',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.removeWorktree',
      when: 'false',
    });
  });

  it('contributes add terminal as the inline `+` action on Worktree rows', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.addTerminal',
      title: 'Add Terminal',
      icon: '$(add)',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.addTerminal',
      ),
    ).toEqual([{
      command: 'deck.addTerminal',
      when:
        'view == deck.repositories && (viewItem == deck.worktree || viewItem == deck.worktree.active || viewItem == deck.worktree.main) && deck.tmuxAvailable',
      group: 'inline',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.addTerminal',
      when: 'false',
    });
  });

  it('contributes TerminalLauncher as an inline play action on Worktree rows', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.runLauncher',
      title: 'Run Terminal Launcher',
      icon: '$(play)',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.runLauncher',
      ),
    ).toEqual([{
      command: 'deck.runLauncher',
      when:
        'view == deck.repositories && (viewItem == deck.worktree || viewItem == deck.worktree.active || viewItem == deck.worktree.main) && deck.tmuxAvailable',
      group: 'inline@5',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.runLauncher',
      when: 'false',
    });
  });

  it('contributes remove repository only as a Repository context action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.removeRepository',
      title: 'Remove from Deck…',
    });

    expect(pkg.contributes.menus['view/item/context']).toContainEqual({
      command: 'deck.removeRepository',
      when: 'view == deck.repositories && viewItem == deck.repository',
      group: 'navigation',
    });
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.removeRepository',
      when: 'false',
    });
  });

  it('contributes open Worktree in new window as a Worktree context-only action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.openWorktreeInNewWindow',
      title: 'Open Worktree in New Window',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.openWorktreeInNewWindow',
      ),
    ).toEqual([{
      command: 'deck.openWorktreeInNewWindow',
      when: 'view == deck.repositories && (viewItem == deck.worktree || viewItem == deck.worktree.main)',
      group: 'navigation@2',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.openWorktreeInNewWindow',
      when: 'false',
    });
    expect(
      pkg.contributes.keybindings.some(
        (item: { command: string }) => item.command === 'deck.openWorktreeInNewWindow',
      ),
    ).toBe(false);
  });

  it('contributes Delete Terminal as a context-menu and keybinding action on Terminal rows', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.killTerminal',
      title: 'Delete Terminal',
    });

    const killWhen =
      'view == deck.repositories && (viewItem == deck.terminal.active || viewItem == deck.terminal.foreign) && deck.tmuxAvailable';
    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.killTerminal',
      ),
    ).toEqual([
      { command: 'deck.killTerminal', when: killWhen, group: 'navigation' },
    ]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.killTerminal',
      when: 'false',
    });
    // cmd+backspace deletes the selected Terminal (Worktree delete is right-click
    // only — VS Code can't pass the keyboard-focused row, microsoft/vscode#130880).
    expect(pkg.contributes.keybindings).toContainEqual({
      command: 'deck.killTerminal',
      key: 'ctrl+backspace',
      mac: 'cmd+backspace',
      when: "focusedView == 'deck.repositories' && deck.tmuxAvailable",
    });
  });

  it('contributes open Terminal in new window as a Terminal context-only action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.openTerminalInNewWindow',
      title: 'Open Terminal in New Window',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.openTerminalInNewWindow',
      ),
    ).toEqual([{
      command: 'deck.openTerminalInNewWindow',
      when: 'view == deck.repositories && viewItem == deck.terminal.foreign && deck.tmuxAvailable',
      group: 'navigation',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.openTerminalInNewWindow',
      when: 'false',
    });
  });

  it('contributes switch to Worktree as a Worktree context-only action, not a row click', () => {
    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.switchWorktree',
      ),
    ).toEqual([{
      command: 'deck.switchWorktree',
      when: 'view == deck.repositories && (viewItem == deck.worktree || viewItem == deck.worktree.main)',
      group: 'navigation@1',
    }]);
    expect(
      pkg.contributes.menus['view/item/context'].some(
        (item: { command: string; group?: string }) =>
          item.command === 'deck.switchWorktree' && item.group === 'inline',
      ),
    ).toBe(false);
  });

  it('hides switch to Worktree from the command palette (needs a worktree-path argument)', () => {
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.switchWorktree',
      when: 'false',
    });
  });
});

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
