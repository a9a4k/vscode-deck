import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoots: string[] = [];

const vscodeState = vi.hoisted(() => ({
  addRepositoryArgs: undefined as unknown[] | undefined,
  addTerminalArgs: undefined as unknown[] | undefined,
  addRepositoryRun: vi.fn(),
  addTerminalRun: vi.fn(),
  agentDetectionArgs: undefined as unknown[] | undefined,
  agentPaneProbeInstances: [] as Array<{ args: unknown[] }>,
  agentSetupPromptArgs: undefined as unknown[] | undefined,
  agentSetupPromptRun: vi.fn(),
  agentSetupPromptUninstall: vi.fn(),
  agentSidecarStoreArgs: undefined as unknown[] | undefined,
  agentSidecarStoreInstance: undefined as unknown,
  agentSidecarStorePrune: vi.fn(async () => undefined),
  agentSidecarStoreReadAll: vi.fn(async () => new Map()),
  agentSidecarStoreRemove: vi.fn(async () => undefined),
  agentStatusStoreArgs: undefined as unknown[] | undefined,
  agentStatusStoreMarkRead: vi.fn(async () => undefined),
  agentStatusStoreChange: undefined as (() => void) | undefined,
  agentStatusStoreEntries: [] as Array<[
    string,
    {
      status: 'inProgress' | 'needsInput' | 'completed' | 'failed';
      statusAt: number;
      agent?: 'claude' | 'codex';
      message?: string;
    },
  ]>,
  agentStatusStorePrune: vi.fn(async () => undefined),
  agentTitlePollArgs: undefined as unknown[] | undefined,
  agentTitlePollInstances: [] as Array<{
    start: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onChange: ReturnType<typeof vi.fn>;
    listener?: (changedSessionNames: readonly string[]) => void;
  }>,
  restoreOnActivationImpl: (async () => undefined) as () => Promise<unknown>,
  agentStatusStoreStart: vi.fn(async () => ({ dispose: vi.fn() })),
  agentStatusStoreChangeListeners: [] as Array<() => void>,
  agentStatusStoreChangeListener: undefined as (() => void) | undefined,
  hookInstallerArgs: undefined as unknown[] | undefined,
  hookInstallerReconcile: vi.fn(async () => [] as Array<{ agent: 'claude' | 'codex'; configPath: string }>),
  hookInstallerRemove: vi.fn(),
  configUpdate: vi.fn(),
  externalWatchDisposables: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  tabGroups: [] as Array<{ viewColumn: number; tabs: Array<{ input?: unknown }> }>,
  createTreeView: vi.fn(() => ({
    message: undefined as string | undefined,
    dispose: vi.fn(),
    onDidCollapseElement: vi.fn(() => ({ dispose: vi.fn() })),
    onDidExpandElement: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(async () => undefined),
    get selection() {
      return vscodeState.treeViewSelection;
    },
  })),
  executeCommand: vi.fn(),
  terminalRemovalRun: vi.fn(),
  terminalRemovalArgs: undefined as unknown[] | undefined,
  lifecycleOrder: [] as string[],
  activeTab: undefined as { input?: unknown } | undefined,
  onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeActiveTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTabGroups: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWindowState: vi.fn(() => ({ dispose: vi.fn() })),
  windowFocused: true,
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  onDidOpenTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  openTerminalInNewWindowRun: vi.fn(),
  openTerminalRun: vi.fn(),
  openTerminalArgs: undefined as unknown[] | undefined,
  repositoryTreeArgs: undefined as unknown[] | undefined,
  repositoryTreeInstances: [] as Array<{
    findTerminal: ReturnType<typeof vi.fn>;
    findTerminalBySessionName: ReturnType<typeof vi.fn>;
    describeSession: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    getChildren: ReturnType<typeof vi.fn>;
  }>,
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  registerCustomEditorProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerFileDecorationProvider: vi.fn(() => ({ dispose: vi.fn() })),
  removeWorktreeArgs: undefined as unknown[] | undefined,
  settingsRepositories: ['/settings/repo'],
  settingsAgentResumeTemplates: {} as Record<string, string | undefined>,
  settingsAgentStatusNotifications: {} as {
    notifyOnNeedsInput?: string;
    notifyOnCompleted?: string;
  },
  settingsDeckTmux: {} as {
    automaticRenameFormat?: string;
  },
  tmuxServerRunning: false,
  tmuxSessions: [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh', paneTitle: undefined as string | undefined }],
  tmuxInstances: [] as Array<{
    configPath: string;
    isServerRunning: ReturnType<typeof vi.fn>;
    killSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    newAnchorSession: ReturnType<typeof vi.fn>;
    panePid: ReturnType<typeof vi.fn>;
    serverStartTime: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    unsetOption: ReturnType<typeof vi.fn>;
  }>,
  terminalSnapshotRuntimeInstances: [] as Array<{
    tmux: unknown;
    saveScriptPath: () => string;
    beforeRestore: () => Promise<void>;
    wedgeRecovery: unknown;
    restoreFeedback: unknown;
    saveLock: unknown;
    save: ReturnType<typeof vi.fn>;
    restoreOnActivation: ReturnType<typeof vi.fn>;
    startPeriodicSave: ReturnType<typeof vi.fn>;
    periodicSave: { dispose: ReturnType<typeof vi.fn> };
  }>,
  watchGitCommonDir: vi.fn(),
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
  tmuxPreflight: vi.fn(async () => ({ available: true })),
  configListeners: [] as Array<(event: { affectsConfiguration(section: string): boolean }) => unknown>,
  rewriteTerminalSnapshotAgentSessions: vi.fn(async () => undefined),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  withProgress: vi.fn((_options, task: (progress: { report(update: unknown): void }) => Promise<unknown>) =>
    task({ report: vi.fn() }),
  ),
  showTextDocument: vi.fn(),
  workspaceFsStat: vi.fn(async () => ({})),
  treeViewSelection: [] as unknown[],
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  ViewColumn: { Active: -1 },
  ProgressLocation: { Notification: 15 },
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
  FileDecoration: class {
    constructor(
      readonly badge?: string,
      readonly tooltip?: string,
      readonly color?: unknown,
    ) {}
  },
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  commands: {
    executeCommand: vscodeState.executeCommand,
    registerCommand: vscodeState.registerCommand,
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  window: {
    activeColorTheme: { kind: 2 },
    createTreeView: vscodeState.createTreeView,
    registerFileDecorationProvider: vscodeState.registerFileDecorationProvider,
    registerCustomEditorProvider: vscodeState.registerCustomEditorProvider,
    showWarningMessage: vscodeState.showWarningMessage,
    showInformationMessage: vscodeState.showInformationMessage,
    withProgress: vscodeState.withProgress,
    showTextDocument: vscodeState.showTextDocument,
    state: {
      get focused() {
        return vscodeState.windowFocused;
      },
    },
    onDidChangeWindowState: vscodeState.onDidChangeWindowState,
    onDidCloseTerminal: vscodeState.onDidCloseTerminal,
    onDidChangeActiveTerminal: vscodeState.onDidChangeActiveTerminal,
    onDidOpenTerminal: vscodeState.onDidOpenTerminal,
    get tabGroups() {
      return {
        all: vscodeState.tabGroups,
        activeTabGroup: { activeTab: vscodeState.activeTab },
        onDidChangeTabGroups: vscodeState.onDidChangeTabGroups,
        onDidChangeTabs: vscodeState.onDidChangeTabs,
      };
    },
  },
  workspace: {
    getConfiguration: (section?: string) => ({
      get: <T>(key: string, defaultValue?: T) => {
        if (section === 'deck.tmux' && key === 'automaticRenameFormat') {
          return (vscodeState.settingsDeckTmux.automaticRenameFormat as T | undefined) ?? defaultValue;
        }
        if (key === 'repositories') return (vscodeState.settingsRepositories as T | undefined) ?? defaultValue;
        if (key === 'agentResumeTemplates.claude') {
          return (vscodeState.settingsAgentResumeTemplates.claude as T | undefined) ?? defaultValue;
        }
        if (key === 'agentResumeTemplates.codex') {
          return (vscodeState.settingsAgentResumeTemplates.codex as T | undefined) ?? defaultValue;
        }
        if (key === 'notifyOnNeedsInput') {
          return (vscodeState.settingsAgentStatusNotifications.notifyOnNeedsInput as T | undefined) ?? defaultValue;
        }
        if (key === 'notifyOnCompleted') {
          return (vscodeState.settingsAgentStatusNotifications.notifyOnCompleted as T | undefined) ?? defaultValue;
        }
        return defaultValue;
      },
      update: vscodeState.configUpdate,
    }),
    fs: {
      stat: vscodeState.workspaceFsStat,
    },
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration(section: string): boolean }) => unknown) => {
      vscodeState.onDidChangeConfiguration(listener);
      vscodeState.configListeners.push(listener);
      return { dispose: vi.fn() };
    },
    onDidChangeWorkspaceFolders: vscodeState.onDidChangeWorkspaceFolders,
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

vi.mock('../src/switch/activeWorktreeStore', () => ({
  ActiveWorktreeStore: class {},
}));

vi.mock('../src/worktree/worktreeRootStore', () => ({
  WorktreeRootStore: class {},
}));

vi.mock('../src/worktree/branchDeletionPreferenceStore', () => ({
  BranchDeletionPreferenceStore: class {},
}));

vi.mock('../src/worktree/worktreeListCacheStore', () => ({
  WorktreeListCacheStore: class {},
}));

vi.mock('../src/repository/repositoryCommonDirCache', () => ({
  RepositoryCommonDirCache: class {},
  resolveCommonDirSafe: vi.fn(async () => null),
}));

vi.mock('../src/repository/vscodeExternalGitWatch', () => ({
  watchGitCommonDir: vscodeState.watchGitCommonDir,
}));

vi.mock('../src/repository/addRepositoryCommand', () => ({
  AddRepositoryCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.addRepositoryArgs = args;
    }

    run = vscodeState.addRepositoryRun;
  },
  VsCodeRepositoryFolderPicker: class {},
}));

vi.mock('../src/switch/worktreeSwitcher', () => ({
  WorktreeSwitcher: class {},
}));


vi.mock('../src/worktree/addWorktreeCommand', () => ({
  AddWorktreeCommand: class {},
}));

vi.mock('../src/worktree/worktreeRemovalCommand', () => ({
  WorktreeRemovalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.removeWorktreeArgs = args;
    }
  },
}));

vi.mock('../src/repository/repositoryRemovalCommand', () => ({
  RepositoryRemovalCommand: class {},
}));

vi.mock('../src/tree/repositoryTree', () => ({
  RepositoryTreeProvider: class {
    agentStatusDecorationRollups = {
      setStatuses: vi.fn(),
      setTerminals: vi.fn(),
      getDecorationStatus: vi.fn(),
    };
    findTerminal = vi.fn();
    findTerminalBySessionName = vi.fn();
    describeSession = vi.fn();
    refresh = vi.fn();
    setCollapsed = vi.fn();
    getChildren = vi.fn(() => [{ repositoryPath: '/settings/repo' }]);

    constructor(...args: unknown[]) {
      vscodeState.repositoryTreeArgs = args;
      vscodeState.repositoryTreeInstances.push(this);
    }
  },
}));

vi.mock('../src/tree/deckTreeDragAndDropController', () => ({
  DeckTreeDragAndDropController: class {},
}));

vi.mock('../src/terminal/tmuxPreflight', () => ({
  tmuxPreflight: vscodeState.tmuxPreflight,
}));

vi.mock('../src/terminal/tmuxCli', () => ({
  TmuxCli: class {
    configPath: string;
    killSession = vi.fn(async () => undefined);
    newAnchorSession = vi.fn(async () => undefined);
    panePid = vi.fn(async () => 1234);
    windowName = vi.fn(async () => 'zsh');
    terminalSession = vi.fn(async (sessionName: string) =>
      vscodeState.tmuxSessions.find((session) => session.sessionName === sessionName) ?? {
        sessionName,
        windowName: 'zsh',
      },
    );
    isServerRunning = vi.fn(async () => vscodeState.tmuxServerRunning);
    serverStartTime = vi.fn(async () => 'Thu Jun 11 20:01:00 2026');
    listSessions = vi.fn(async () => {
      vscodeState.lifecycleOrder.push('pending-list');
      return vscodeState.tmuxSessions;
    });
    setOption = vi.fn(async () => undefined);
    unsetOption = vi.fn(async () => undefined);

    constructor(configPath: string) {
      this.configPath = configPath;
      vscodeState.tmuxInstances.push(this);
    }
  },
}));

vi.mock('../src/terminal/terminalSnapshotRuntime', () => ({
  TERMINAL_SNAPSHOT_ANCHOR_SESSION: '__deck_anchor',
  TerminalSnapshotRuntime: class {
    save = vi.fn(async () => undefined);
    restoreOnActivation = vi.fn(() => vscodeState.restoreOnActivationImpl());
    periodicSave = { dispose: vi.fn() };
    startPeriodicSave = vi.fn(() => this.periodicSave);

    constructor(
      public readonly tmux: unknown,
      public readonly saveScriptPath: () => string,
      public readonly restoreScriptPath: () => string,
      public readonly anchorCwd: () => string,
      public readonly beforeRestore: () => Promise<void>,
      public readonly wedgeRecovery: unknown,
      public readonly restoreFeedback: unknown,
      public readonly saveLock: unknown,
    ) {
      vscodeState.terminalSnapshotRuntimeInstances.push(this);
    }
  },
}));

vi.mock('../src/agent/terminalSnapshotAgentSessions', () => ({
  rewriteTerminalSnapshotAgentSessions: vscodeState.rewriteTerminalSnapshotAgentSessions,
}));

vi.mock('../src/agent/agentSidecarStore', () => ({
  AgentSidecarStore: class {
    prune = vscodeState.agentSidecarStorePrune;
    readAll = vscodeState.agentSidecarStoreReadAll;
    remove = vscodeState.agentSidecarStoreRemove;

    constructor(...args: unknown[]) {
      vscodeState.agentSidecarStoreArgs = args;
      vscodeState.agentSidecarStoreInstance = this;
    }
  },
}));

vi.mock('../src/agent/agentPaneProbe', () => ({
  AgentPaneProbe: class {
    args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
      vscodeState.agentPaneProbeInstances.push(this);
    }
  },
}));

vi.mock('../src/agent/agentStatusStore', () => ({
  AgentStatusStore: class {
    get = vi.fn();
    markRead = vscodeState.agentStatusStoreMarkRead;
    entries = vi.fn(() => vscodeState.agentStatusStoreEntries.values());
    onDidChange = vi.fn((listener: () => void) => {
      vscodeState.agentStatusStoreChangeListeners.push(listener);
      if (!vscodeState.agentStatusStoreChangeListener) {
        vscodeState.agentStatusStoreChangeListener = listener;
      } else if (!vscodeState.agentStatusStoreChange) {
        vscodeState.agentStatusStoreChange = listener;
      }
      return { dispose: vi.fn() };
    });
    prune = vscodeState.agentStatusStorePrune;
    start = vscodeState.agentStatusStoreStart;

    constructor(...args: unknown[]) {
      vscodeState.agentStatusStoreArgs = args;
    }
  },
}));

vi.mock('../src/agent/agentTitlePoll', () => ({
  AgentTitlePoll: class {
    listener?: (changedSessionNames: readonly string[]) => void;
    start = vi.fn();
    dispose = vi.fn();
    onChange = vi.fn((listener: (changedSessionNames: readonly string[]) => void) => {
      this.listener = listener;
      return { dispose: vi.fn() };
    });

    constructor(...args: unknown[]) {
      vscodeState.agentTitlePollArgs = args;
      vscodeState.agentTitlePollInstances.push(this);
    }
  },
}));

vi.mock('../src/agent/hookInstaller', () => ({
  HookInstaller: class {
    constructor(...args: unknown[]) {
      vscodeState.hookInstallerArgs = args;
    }

    remove = vscodeState.hookInstallerRemove;
    reconcileInstalledHooks = vscodeState.hookInstallerReconcile;
  },
}));

vi.mock('../src/agent/agentDetection', () => ({
  AgentDetection: class {
    constructor(...args: unknown[]) {
      vscodeState.agentDetectionArgs = args;
    }
  },
}));

vi.mock('../src/agent/agentSetupPrompt', () => ({
  AGENT_HOOK_SETUP_DISMISSED_KEY: 'deck.agentHooks.setup.dismissed',
  AgentSetupPrompt: class {
    constructor(...args: unknown[]) {
      vscodeState.agentSetupPromptArgs = args;
    }

    run = vscodeState.agentSetupPromptRun;
    uninstall = vscodeState.agentSetupPromptUninstall;
  },
}));

vi.mock('../src/terminal/addTerminalCommand', () => ({
  AddTerminalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.addTerminalArgs = args;
    }

    run = vscodeState.addTerminalRun;
  },
}));

vi.mock('../src/terminal/openTerminalCommand', () => ({
  OpenTerminalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.openTerminalArgs = args;
    }

    run = vscodeState.openTerminalRun;
  },
}));

vi.mock('../src/terminal/openTerminalInNewWindowCommand', () => ({
  OpenTerminalInNewWindowCommand: class {
    run = vscodeState.openTerminalInNewWindowRun;
  },
}));

vi.mock('../src/terminal/killTerminalCommand', () => ({
  TerminalRemovalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.terminalRemovalArgs = args;
    }

    run = vscodeState.terminalRemovalRun;
  },
}));

import * as vscode from 'vscode';
import { activate, deactivate, openPendingTerminalForCurrentWorktree } from '../src/extension';
import { resolveCommonDirSafe } from '../src/repository/repositoryCommonDirCache';
import { PendingTerminalOpenStore } from '../src/terminal/pendingTerminalOpenStore';
import { SessionUriCodec } from '../src/terminal/sessionUriCodec';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.addRepositoryArgs = undefined;
    vscodeState.addTerminalArgs = undefined;
    vscodeState.agentDetectionArgs = undefined;
    vscodeState.agentPaneProbeInstances = [];
    vscodeState.agentSetupPromptArgs = undefined;
    vscodeState.agentSidecarStoreArgs = undefined;
    vscodeState.agentSidecarStoreInstance = undefined;
    vscodeState.agentSidecarStorePrune.mockResolvedValue(undefined);
    vscodeState.agentSidecarStoreReadAll.mockResolvedValue(new Map());
    vscodeState.agentSidecarStoreRemove.mockResolvedValue(undefined);
    vscodeState.agentStatusStoreChangeListener = undefined;
    vscodeState.agentStatusStoreMarkRead.mockResolvedValue(undefined);
    vscodeState.agentSetupPromptRun.mockResolvedValue(undefined);
    vscodeState.agentSetupPromptUninstall.mockResolvedValue(undefined);
    vscodeState.agentStatusStoreArgs = undefined;
    vscodeState.agentStatusStoreChange = undefined;
    vscodeState.agentStatusStoreChangeListeners = [];
    vscodeState.agentStatusStoreEntries = [];
    vscodeState.agentStatusStorePrune.mockResolvedValue(undefined);
    vscodeState.agentTitlePollArgs = undefined;
    vscodeState.agentTitlePollInstances = [];
    vscodeState.restoreOnActivationImpl = async () => undefined;
    vscodeState.agentStatusStoreStart.mockResolvedValue({ dispose: vi.fn() });
    vscodeState.hookInstallerArgs = undefined;
    vscodeState.hookInstallerReconcile.mockResolvedValue([]);
    vscodeState.hookInstallerReconcile.mockClear();
    vscodeState.hookInstallerRemove.mockResolvedValue([]);
    vscodeState.externalWatchDisposables = [];
    vscodeState.terminalRemovalArgs = undefined;
    vscodeState.activeTab = undefined;
    vscodeState.lifecycleOrder = [];
    vscodeState.openTerminalArgs = undefined;
    vscodeState.repositoryTreeArgs = undefined;
    vscodeState.repositoryTreeInstances = [];
    vscodeState.removeWorktreeArgs = undefined;
    vscodeState.settingsRepositories = ['/settings/repo'];
    vscodeState.settingsAgentResumeTemplates = {};
    vscodeState.settingsAgentStatusNotifications = {};
    vscodeState.settingsDeckTmux = {};
    vscodeState.tmuxServerRunning = false;
    vscodeState.tmuxSessions = [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' }];
    vscodeState.tmuxInstances = [];
    vscodeState.terminalSnapshotRuntimeInstances = [];
    vscodeState.rewriteTerminalSnapshotAgentSessions.mockClear();
    vscodeState.watchGitCommonDir.mockImplementation(() => {
      const disposable = { dispose: vi.fn() };
      vscodeState.externalWatchDisposables.push(disposable);
      return disposable;
    });
    vscodeState.onDidChangeTabGroups.mockClear();
    vscodeState.onDidChangeTabs.mockClear();
    vscodeState.onDidChangeWindowState.mockClear();
    vscodeState.windowFocused = true;
    vscodeState.tabGroups = [];
    vscodeState.treeViewSelection = [];
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    vscodeState.configUpdate.mockResolvedValue(undefined);
    vscodeState.tmuxPreflight.mockResolvedValue({ available: true });
    vscodeState.configListeners = [];
    vscodeState.showWarningMessage.mockClear();
    vscodeState.showInformationMessage.mockReset();
    vscodeState.withProgress.mockClear();
    vscodeState.withProgress.mockImplementation((_options, task) => task({ report: vi.fn() }));
    vscodeState.showTextDocument.mockClear();
    vscodeState.workspaceFsStat.mockResolvedValue({});
    vscodeState.workspaceFsStat.mockClear();
    vi.mocked(resolveCommonDirSafe).mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.XDG_DATA_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createContext(globalRepositories: string[] = []) {
    const values: Record<string, unknown> = { 'deck.repositoryRegistry': globalRepositories };
    const globalStoragePath = mkdtempSync(join(tmpdir(), 'deck-test-global-'));
    tempRoots.push(globalStoragePath);
    const xdgDataHome = mkdtempSync(join(tmpdir(), 'deck-test-xdg-'));
    tempRoots.push(xdgDataHome);
    process.env.XDG_DATA_HOME = xdgDataHome;
    return {
      xdgDataHome,
      globalState: {
        get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
        update: vi.fn(async (key: string, value: unknown) => {
          values[key] = value;
        }),
      },
      workspaceState: {
        get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
        update: vi.fn(async (key: string, value: unknown) => {
          values[key] = value;
        }),
      },
      subscriptions: [] as Array<{ dispose(): void }>,
      extensionPath: process.cwd(),
      extensionUri: { fsPath: process.cwd() },
      globalStorageUri: { fsPath: globalStoragePath },
      values,
    };
  }

  const terminalUriCodec = new SessionUriCodec();

  function terminalEditorTab(worktreePath: string, term: number) {
    return {
      input: {
        viewType: 'deck.terminal',
        uri: terminalUriCodec.encode({ worktreePath, term }),
      },
    };
  }

  it('creates the Repositories tree view with drag-and-drop enabled', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscode.window.createTreeView).toHaveBeenCalledWith(
      'deck.repositories',
      expect.objectContaining({
        canSelectMany: false,
        dragAndDropController: expect.any(Object),
        treeDataProvider: expect.any(Object),
      }),
    );
    expect(context.subscriptions[0]).toBe(vscodeState.createTreeView.mock.results[0].value);
  });

  it('registers agent status file decorations without a Deck view badge', async () => {
    vscodeState.agentStatusStoreEntries = [
      ['wt-_work_alpha-main__term-1', { status: 'needsInput', statusAt: 1710000000 }],
      ['wt-_work_alpha-main__term-2', { status: 'completed', statusAt: 1710000001 }],
    ];
    const context = createContext();

    await activate(context as never);
    const treeView = vscodeState.createTreeView.mock.results[0].value as { badge?: unknown };

    expect(vscode.window.registerFileDecorationProvider).toHaveBeenCalledWith(expect.any(Object));
    expect(treeView.badge).toBeUndefined();
  });

  it('uses RepositoryRegistryStore without migrating legacy settings', async () => {
    const context = createContext(['/global/repo']);

    await activate(context as never);

    expect(context.values['deck.repositoryRegistry']).toEqual(['/global/repo']);
    expect(vscodeState.configUpdate).not.toHaveBeenCalled();
  });

  it('registers deck.addRepository through AddRepositoryCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const addRepositoryRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.addRepository',
    );
    if (!addRepositoryRegistration) throw new Error('missing deck.addRepository registration');
    await addRepositoryRegistration[1]();

    expect(vscodeState.addRepositoryRun).toHaveBeenCalledOnce();
  });

  it('sets tmux availability context and passes it to the tree', async () => {
    vscodeState.tmuxPreflight.mockResolvedValue({ available: false });
    const context = createContext();

    await activate(context as never);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'deck.tmuxAvailable',
      false,
    );
    expect(vscodeState.repositoryTreeArgs?.[6]).toBe(false);
    expect(vscodeState.terminalSnapshotRuntimeInstances).toEqual([]);
  });

  it('writes generated deck.conf to the machine-global Deck dir and gives tmux that path', async () => {
    const context = createContext();

    await activate(context as never);

    // Both the conf and the snapshot live in one space-free, machine-global
    // Deck dir — NOT globalStorage (per-install, and macOS's "Application
    // Support" space breaks tmux-resurrect's restore.sh).
    const deckDir = join(context.xdgDataHome, 'deck');
    const generatedConf = join(deckDir, 'deck.conf');
    const resurrectDir = join(deckDir, 'resurrect');
    const generatedConfContents = readFileSync(generatedConf, 'utf8');
    expect(existsSync(resurrectDir)).toBe(true);
    expect(generatedConfContents).toContain(
      `set -g @resurrect-dir '${resurrectDir}'`,
    );
    // Regression guard: resurrect's restore.sh restores nothing when
    // @resurrect-dir contains a space, and globalStorage is spaced on macOS.
    expect(resurrectDir).not.toMatch(/\s/);
    expect(resurrectDir.startsWith(context.globalStorageUri.fsPath)).toBe(false);
    expect(generatedConfContents).toContain(
      `run-shell '${join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', 'resurrect.tmux')}'`,
    );
    expect(vscodeState.tmuxInstances[0].configPath).toBe(generatedConf);
  });

  it('writes and live-applies the automatic-rename-format when the DeckSocket is running', async () => {
    vscodeState.tmuxServerRunning = true;
    vscodeState.settingsDeckTmux = {
      automaticRenameFormat: '#{pane_current_command}:#{pane_current_path}',
    };
    const context = createContext();

    await activate(context as never);

    const deckDir = join(context.xdgDataHome, 'deck');
    const generatedConf = join(deckDir, 'deck.conf');
    expect(readFileSync(generatedConf, 'utf8')).toContain(
      "set -g automatic-rename-format '#{pane_current_command}:#{pane_current_path}'\nset -g history-limit 5000",
    );
    expect(vscodeState.tmuxInstances[0].setOption).toHaveBeenCalledWith(
      'automatic-rename-format',
      '#{pane_current_command}:#{pane_current_path}',
    );
  });

  it('rewrites deck.conf and unsets automatic rename format when the tmux setting is cleared', async () => {
    vscodeState.tmuxServerRunning = true;
    vscodeState.settingsDeckTmux = {
      automaticRenameFormat: '#{pane_current_command}',
    };
    const context = createContext();

    await activate(context as never);
    vscodeState.settingsDeckTmux.automaticRenameFormat = '';
    await Promise.all(vscodeState.configListeners.map((listener) => listener({
      affectsConfiguration: (section) => section === 'deck.tmux',
    })));

    const generatedConf = join(context.xdgDataHome, 'deck', 'deck.conf');
    expect(readFileSync(generatedConf, 'utf8')).not.toContain('automatic-rename-format');
    expect(vscodeState.tmuxInstances[0].unsetOption).toHaveBeenCalledWith('automatic-rename-format');
  });

  it('starts TerminalSnapshot periodic saves and fires one best-effort save on deactivate', async () => {
    const context = createContext();

    await activate(context as never);

    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    expect(runtime.tmux).toBe(vscodeState.tmuxInstances[0]);
    expect(runtime.saveScriptPath()).toBe(
      join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', 'scripts', 'save.sh'),
    );
    expect((runtime.saveLock as { options?: { lockFilename?: string } }).options?.lockFilename).toBe(
      'deck-socket-snapshot.lock',
    );
    expect(runtime.startPeriodicSave).toHaveBeenCalledWith(5 * 60 * 1000);
    expect(context.subscriptions).toContain(runtime.periodicSave);

    deactivate();
    deactivate();

    expect(runtime.save).toHaveBeenCalledOnce();
  });

  it('restores the TerminalSnapshot during activation when tmux is available', async () => {
    vscodeState.tmuxSessions = [];
    const context = createContext();

    await activate(context as never);

    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    expect(runtime.restoreOnActivation).toHaveBeenCalledOnce();
  });

  it('constructs the agent exit sweep from the sidecar store', async () => {
    const context = createContext();

    await activate(context as never);

    const sweep = context.subscriptions.find((subscription) => 'runOnce' in subscription) as {
      options?: { sidecars?: unknown; paneProbe?: unknown; panes?: unknown; serverStart?: unknown };
    } | undefined;
    expect(sweep?.options?.sidecars).toBe(vscodeState.agentSidecarStoreInstance);
    expect(sweep?.options?.serverStart).toBe(vscodeState.tmuxInstances[0]);
    expect(sweep?.options?.paneProbe).toBe(vscodeState.agentPaneProbeInstances[0]);
    expect(vscodeState.agentPaneProbeInstances[0]?.args[0]).toBe(vscodeState.tmuxInstances[0]);
    expect(sweep?.options?.panes).toBeUndefined();
  });

  it('does not prune agent files during activation restore', async () => {
    // Regression guard: prune keys on a point-in-time session list, so a
    // concurrent or partial restore can wipe resume-candidate sidecars.
    vscodeState.tmuxSessions = [];
    let finishRestore = () => undefined;
    vscodeState.restoreOnActivationImpl = () =>
      new Promise<void>((resolve) => {
        finishRestore = () => {
          vscodeState.tmuxSessions = [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' }];
          resolve();
        };
      });

    const context = createContext();
    const activation = activate(context as never);
    await vi.waitFor(() => {
      expect(vscodeState.terminalSnapshotRuntimeInstances[0].restoreOnActivation).toHaveBeenCalledOnce();
    });

    // Restore is still in flight → prune must not have run yet.
    expect(vscodeState.agentSidecarStorePrune).not.toHaveBeenCalled();
    expect(vscodeState.agentStatusStorePrune).not.toHaveBeenCalled();

    finishRestore();
    await activation;

    expect(vscodeState.agentSidecarStorePrune).not.toHaveBeenCalled();
    expect(vscodeState.agentStatusStorePrune).not.toHaveBeenCalled();
  });

  it('restores an anchor-only DeckSocket without pruning agent files', async () => {
    vscodeState.tmuxSessions = [{ sessionName: '__deck_anchor', windowName: 'zsh' }];
    let finishRestore = () => undefined;
    vscodeState.restoreOnActivationImpl = () =>
      new Promise<void>((resolve) => {
        finishRestore = () => {
          vscodeState.tmuxSessions = [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'claude' }];
          resolve();
        };
      });

    const context = createContext();
    const activation = activate(context as never);
    await vi.waitFor(() => {
      expect(vscodeState.terminalSnapshotRuntimeInstances[0].restoreOnActivation).toHaveBeenCalledOnce();
    });
    expect(vscodeState.agentSidecarStorePrune).not.toHaveBeenCalled();
    expect(vscodeState.agentStatusStorePrune).not.toHaveBeenCalled();

    finishRestore();
    await activation;

    expect(vscodeState.agentSidecarStorePrune).not.toHaveBeenCalled();
    expect(vscodeState.agentStatusStorePrune).not.toHaveBeenCalled();
  });

  it('wakes the agent exit sweep only after the activation restore completes', async () => {
    vscodeState.tmuxSessions = [];
    let finishRestore = () => undefined;
    vscodeState.restoreOnActivationImpl = () =>
      new Promise<void>((resolve) => {
        finishRestore = () => {
          vscodeState.tmuxSessions = [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' }];
          resolve();
        };
      });

    const context = createContext();
    const activation = activate(context as never);
    await vi.waitFor(() => {
      expect(vscodeState.terminalSnapshotRuntimeInstances[0].restoreOnActivation).toHaveBeenCalledOnce();
    });

    expect(vscodeState.agentSidecarStoreReadAll).not.toHaveBeenCalled();

    finishRestore();
    await activation;

    expect(vscodeState.agentSidecarStoreReadAll).toHaveBeenCalled();
  });

  it('refreshes the tree after the activation TerminalSnapshot restore completes', async () => {
    const context = createContext();

    await activate(context as never);
    await Promise.resolve();

    expect(vscodeState.repositoryTreeInstances[0].refresh).toHaveBeenCalledOnce();
  });

  it('passes restore feedback that shows progress and a sidebar banner', async () => {
    const context = createContext();

    await activate(context as never);
    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    const treeView = vscodeState.createTreeView.mock.results[0].value as { message?: string };
    const restoreFeedback = runtime.restoreFeedback as {
      withProgress(context: { unresponsive: boolean }, task: () => Promise<void>): Promise<void>;
    };
    const messagesDuringRestore: Array<string | undefined> = [];

    await restoreFeedback.withProgress({ unresponsive: true }, async () => {
      messagesDuringRestore.push(treeView.message);
    });

    expect(messagesDuringRestore).toEqual(['Restoring terminals…']);
    expect(treeView.message).toBeUndefined();
    expect(vscodeState.withProgress).toHaveBeenCalledWith(
      {
        location: 15,
        title: "Deck's terminal server is unresponsive. Restarting…",
        cancellable: false,
      },
      expect.any(Function),
    );
  });

  it('uses agent resume template settings when rewriting the TerminalSnapshot', async () => {
    vscodeState.settingsAgentResumeTemplates.codex = 'codex --dangerously-bypass-approvals-and-sandbox resume {id}';
    const context = createContext();

    await activate(context as never);
    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    await runtime.beforeRestore();

    const rewriter = vscodeState.rewriteTerminalSnapshotAgentSessions.mock.calls[0]?.[2];
    if (!rewriter || typeof rewriter !== 'object' || !('rewrite' in rewriter)) {
      throw new Error('missing SnapshotRewriter');
    }

    const rewritten = (rewriter as { rewrite(snapshotText: string, sidecars: ReadonlyMap<string, unknown>): string })
      .rewrite(
        'pane\twt-_work_repo__term-1\t0\t1\t:*\t0\t%0\t:/work/repo\t1\tcodex\t:codex',
        new Map([
          ['wt-_work_repo__term-1', { agent: 'codex', session_id: 'codex-123' }],
        ]),
      );

    expect(rewritten.split('\t')[10]).toBe(
      ':codex --dangerously-bypass-approvals-and-sandbox resume codex-123',
    );
  });

  it('syncs one ExternalGitWatch per registered Repository common dir', async () => {
    const context = createContext(['/work/alpha-main', '/work/alpha-linked']);
    vi.mocked(resolveCommonDirSafe).mockResolvedValue('/git/alpha');

    await activate(context as never);
    await Promise.resolve();

    expect(vscodeState.watchGitCommonDir).toHaveBeenCalledOnce();
    expect(vscodeState.watchGitCommonDir).toHaveBeenCalledWith('/git/alpha', expect.any(Function));

    vi.mocked(resolveCommonDirSafe).mockImplementation(async (_cache, repositoryPath) =>
      repositoryPath === '/work/alpha-main' ? '/git/alpha' : '/git/beta',
    );
    const refreshRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.refresh',
    );
    if (!refreshRegistration) throw new Error('missing deck.refresh registration');
    refreshRegistration[1]();

    await vi.waitFor(() => expect(vscodeState.watchGitCommonDir).toHaveBeenCalledTimes(2));
    expect(vscodeState.watchGitCommonDir).toHaveBeenLastCalledWith('/git/beta', expect.any(Function));
    expect(vscodeState.externalWatchDisposables[0].dispose).not.toHaveBeenCalled();
  });

  it('wires AgentTitlePoll changes to row and tab title refresh', async () => {
    const context = createContext();
    await activate(context as never);
    const tree = vscodeState.repositoryTreeInstances[0];
    const poll = vscodeState.agentTitlePollInstances[0];
    const provider = vscodeState.registerCustomEditorProvider.mock.calls[0]?.[1] as {
      refreshTitles(changedSessionNames: readonly string[]): void;
    };
    const refreshTitles = vi.spyOn(provider, 'refreshTitles');
    tree.refresh.mockClear();

    poll.listener?.(['wt-_work_alpha-main__term-1']);

    expect(tree.refresh).toHaveBeenCalledOnce();
    expect(refreshTitles).toHaveBeenCalledWith(['wt-_work_alpha-main__term-1']);
    expect(poll.start).toHaveBeenCalled();
  });

  it('shares pending WorktreeRemoval state between the command and tree', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscodeState.repositoryTreeArgs?.[7]).toBeInstanceOf(Set);
    expect(vscodeState.removeWorktreeArgs?.[6]).toBe(vscodeState.repositoryTreeArgs?.[7]);
  });

  it('consumes pending intents and registers no VS Code terminal listeners', async () => {
    const context = createContext();
    context.values['deck.pendingTerminalOpen'] = {
      schemaVersion: 1,
      entries: {
        '/work/alpha-main': {
          sessionName: 'wt-_work_alpha-main__term-1',
          createdAt: Date.now(),
        },
      },
    };
    await activate(context as never);

    expect(vscodeState.onDidOpenTerminal).not.toHaveBeenCalled();
    expect(vscodeState.onDidCloseTerminal).not.toHaveBeenCalled();
    expect(vscodeState.onDidChangeActiveTerminal).not.toHaveBeenCalled();
    // Tab restoration is now VS Code's native custom-editor restore — Deck no
    // longer replays a snapshot. The pending-intent open and restore classifier
    // each list tmux sessions; the agent exit sweep reads sidecars instead.
    expect(vscodeState.lifecycleOrder).toEqual([
      'pending-list',
      'pending-list',
    ]);
    expect(vscodeState.agentSidecarStorePrune).not.toHaveBeenCalled();
    expect(vscodeState.agentStatusStorePrune).not.toHaveBeenCalled();
  });

  it('registers deck.addTerminal through AddTerminalCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const addTerminalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.addTerminal',
    );
    if (!addTerminalRegistration) throw new Error('missing deck.addTerminal registration');
    await addTerminalRegistration[1]({ worktree: { path: '/work/repo' } });

    expect(vscodeState.addTerminalRun).toHaveBeenCalledWith({ worktree: { path: '/work/repo' } });
  });

  it('registers deck.installAgentHooks through the setup prompt', async () => {
    const context = createContext();

    await activate(context as never);
    expect(vscodeState.agentSetupPromptRun).toHaveBeenCalledWith();
    const registration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.installAgentHooks',
    );
    if (!registration) throw new Error('missing deck.installAgentHooks registration');
    await registration[1]();

    expect(vscodeState.agentSetupPromptRun).toHaveBeenCalledWith({ explicit: true });
  });

  it('notifies after activation reconciles installed agent hooks and reviews the backup diff', async () => {
    const context = createContext();
    vscodeState.hookInstallerReconcile.mockResolvedValue([
      { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
    ]);
    vscodeState.showInformationMessage.mockResolvedValue('Review Changes');

    await activate(context as never);

    await vi.waitFor(() => {
      expect(vscodeState.hookInstallerReconcile).toHaveBeenCalledOnce();
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        'Deck updated its Claude Code hooks for this Deck version',
        'Review Changes',
      );
    });
    await vi.waitFor(() => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        { fsPath: '/home/me/.claude/settings.json.deck.bak' },
        { fsPath: '/home/me/.claude/settings.json' },
        'Deck Claude hooks (before ↔ after)',
      );
    });
  });

  it('shows upgrade toasts for every reconciled agent even while the first toast is pending', async () => {
    const context = createContext();
    vscodeState.hookInstallerReconcile.mockResolvedValue([
      { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
      { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
    ]);
    // An ignored toast keeps its promise pending; the codex toast must not wait on it.
    vscodeState.showInformationMessage.mockImplementation(() => new Promise(() => {}));

    await activate(context as never);

    await vi.waitFor(() => {
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        'Deck updated its Claude Code hooks for this Deck version',
        'Review Changes',
      );
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        'Deck updated its Codex hooks for this Deck version',
        'Review Changes',
      );
    });
  });

  it('registers deck.removeAgentHooks through the setup prompt uninstall flow', async () => {
    const context = createContext();

    await activate(context as never);
    const registration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.removeAgentHooks',
    );
    if (!registration) throw new Error('missing deck.removeAgentHooks registration');
    await registration[1]();

    expect(vscodeState.agentSetupPromptUninstall).toHaveBeenCalledOnce();
  });

  it('registers deck.openTerminal and refreshes on workspace/view visibility events', async () => {
    const context = createContext();

    await activate(context as never);
    const openTerminalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.openTerminal',
    );
    if (!openTerminalRegistration) throw new Error('missing deck.openTerminal registration');
    await openTerminalRegistration[1]({ terminal: { sessionName: 's', windowName: 'zsh' } });

    expect(vscodeState.openTerminalRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
    });
    expect(vscodeState.onDidChangeWorkspaceFolders).toHaveBeenCalledWith(expect.any(Function));
    expect(vscodeState.createTreeView.mock.results[0].value.onDidChangeVisibility).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('opens and reveals a Terminal from an agent status notification action', async () => {
    const context = createContext();
    const terminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
      worktreePath: '/work/alpha-feature',
    };
    vscodeState.showWarningMessage.mockResolvedValue('Open Terminal');

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminalBySessionName.mockResolvedValue(terminalNode);
    vscodeState.repositoryTreeInstances[0].describeSession.mockResolvedValue({
      repo: 'alpha-main',
      branch: 'feature',
    });
    vscodeState.tmuxSessions = [{
      sessionName: 'wt-_work_alpha-feature__term-1',
      windowName: 'claude',
      paneTitle: '✳ fix issue 130',
    }];
    vscodeState.agentStatusStoreEntries = [
      ['wt-_work_alpha-feature__term-1', {
        status: 'needsInput',
        statusAt: 1710000000,
        agent: 'claude',
        message: 'Allow Bash(ls)?',
      }],
    ];
    vscodeState.agentStatusStoreChangeListeners.at(-1)?.();

    await vi.waitFor(() => {
      expect(vscodeState.showWarningMessage).toHaveBeenCalledWith(
        'alpha-main/feature · fix issue 130 · Allow Bash(ls)?',
        'Open Terminal',
      );
    });
    expect(vscodeState.repositoryTreeInstances[0].findTerminalBySessionName).toHaveBeenCalledWith(
      'wt-_work_alpha-feature__term-1',
    );
    await vi.waitFor(() => {
      expect(vscodeState.openTerminalRun).toHaveBeenCalledWith(terminalNode);
    });
    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledWith(
      terminalNode,
      { select: true, focus: false },
    );
  });

  it('explains instead of silently no-opping when the notified Terminal is not in this window', async () => {
    const context = createContext();
    vscodeState.showWarningMessage.mockResolvedValue('Open Terminal');

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminalBySessionName.mockResolvedValue(undefined);
    vscodeState.agentStatusStoreEntries = [
      ['wt-_elsewhere_repo__term-1', { status: 'needsInput', statusAt: 1710000000 }],
    ];
    vscodeState.agentStatusStoreChangeListeners.at(-1)?.();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        "This Terminal's repository isn't registered in this window. Add the repository to Deck to open it.",
      );
    });
    expect(vscodeState.openTerminalRun).not.toHaveBeenCalled();
  });

  it('reveals the active Deck Terminal tab in the tree without taking focus', async () => {
    const context = createContext();
    const terminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    };
    const activeTab = terminalEditorTab('/work/alpha-main', 1);

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminal.mockResolvedValue(terminalNode);
    vscodeState.activeTab = activeTab;
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');
    await tabChangeHandler({ opened: [], closed: [], changed: [activeTab] });

    expect(vscodeState.repositoryTreeInstances[0].findTerminal).toHaveBeenCalledWith(
      'wt-_work_alpha-main__term-1',
      '/work/alpha-main',
    );
    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledWith(
      terminalNode,
      { select: true, focus: false },
    );
  });

  it('does not re-reveal when the active Deck Terminal tab only changes decorations', async () => {
    const context = createContext();
    const terminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    };
    const activeTab = terminalEditorTab('/work/alpha-main', 1);

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminal.mockResolvedValue(terminalNode);
    vscodeState.activeTab = activeTab;
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');

    await tabChangeHandler({ opened: [], closed: [], changed: [activeTab] });
    await tabChangeHandler({ opened: [], closed: [], changed: [activeTab] });

    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledOnce();
  });

  it('reveals again when navigation changes the active Deck Terminal', async () => {
    const context = createContext();
    const firstTerminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    };
    const secondTerminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    };
    const firstTab = terminalEditorTab('/work/alpha-main', 1);
    const secondTab = terminalEditorTab('/work/alpha-main', 2);

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminal.mockImplementation(async (sessionName: string) =>
      sessionName === 'wt-_work_alpha-main__term-1' ? firstTerminalNode : secondTerminalNode,
    );
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');

    vscodeState.activeTab = firstTab;
    await tabChangeHandler({ opened: [], closed: [], changed: [firstTab] });
    vscodeState.activeTab = secondTab;
    await tabChangeHandler({ opened: [], closed: [], changed: [secondTab] });

    const reveal = vscodeState.createTreeView.mock.results[0].value.reveal;
    expect(reveal).toHaveBeenNthCalledWith(1, firstTerminalNode, { select: true, focus: false });
    expect(reveal).toHaveBeenNthCalledWith(2, secondTerminalNode, { select: true, focus: false });
  });

  it('re-reveals when navigation returns from a non-Terminal tab to the same Deck Terminal', async () => {
    const context = createContext();
    const terminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    };
    const terminalTab = terminalEditorTab('/work/alpha-main', 1);
    const fileTab = {
      input: {
        viewType: 'default',
        uri: { scheme: 'file', path: '/work/alpha-main/src/index.ts' },
      },
    };

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminal.mockResolvedValue(terminalNode);
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');

    vscodeState.activeTab = terminalTab;
    await tabChangeHandler({ opened: [], closed: [], changed: [terminalTab] });
    vscodeState.activeTab = fileTab;
    await tabChangeHandler({ opened: [], closed: [], changed: [fileTab] });
    vscodeState.activeTab = terminalTab;
    await tabChangeHandler({ opened: [], closed: [], changed: [terminalTab] });

    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledTimes(2);
  });

  it('marks the active Deck Terminal read when its tab is focused or status changes', async () => {
    const context = createContext();
    const activeTab = terminalEditorTab('/work/alpha-main', 1);

    await activate(context as never);
    vscodeState.activeTab = activeTab;
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');
    await tabChangeHandler({ opened: [], closed: [], changed: [activeTab] });

    expect(vscodeState.agentStatusStoreMarkRead).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');

    vscodeState.agentStatusStoreMarkRead.mockClear();
    vscodeState.agentStatusStoreChangeListener?.();
    await Promise.resolve();

    expect(vscodeState.agentStatusStoreMarkRead).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
  });

  it('does not mark the active Terminal read while the window is unfocused, then does on refocus', async () => {
    const context = createContext();
    vscodeState.activeTab = terminalEditorTab('/work/alpha-main', 1);
    vscodeState.windowFocused = false;

    await activate(context as never);

    // A status change while unfocused must not mark the parked active tab read.
    vscodeState.agentStatusStoreMarkRead.mockClear();
    vscodeState.agentStatusStoreChangeListener?.();
    await Promise.resolve();
    expect(vscodeState.agentStatusStoreMarkRead).not.toHaveBeenCalled();

    // Focusing back marks it read via the window-state listener.
    vscodeState.windowFocused = true;
    const focusHandler = vscodeState.onDidChangeWindowState.mock.calls[0]?.[0];
    if (!focusHandler) throw new Error('missing window-state listener');
    await focusHandler({ focused: true });
    await Promise.resolve();
    expect(vscodeState.agentStatusStoreMarkRead).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
  });

  it('does not reveal a tree row when a non-Terminal tab becomes active', async () => {
    const context = createContext();
    vscodeState.activeTab = {
      input: {
        viewType: 'default',
        uri: {
          scheme: 'file',
          path: '/work/alpha-main/src/index.ts',
        },
      },
    };

    await activate(context as never);
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');
    await tabChangeHandler({ opened: [], closed: [], changed: [vscodeState.activeTab] });

    expect(vscodeState.repositoryTreeInstances[0].findTerminal).not.toHaveBeenCalled();
    expect(vscodeState.createTreeView.mock.results[0].value.reveal).not.toHaveBeenCalled();
  });

  it('registers deck.killTerminal through TerminalRemovalCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const terminalRemovalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.killTerminal',
    );
    if (!terminalRemovalRegistration) throw new Error('missing deck.killTerminal registration');
    await terminalRemovalRegistration[1]({ terminal: { sessionName: 's', windowName: 'zsh' } });

    expect(vscodeState.terminalRemovalRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
    });
  });

  it('deletes the selected Terminal when deck.killTerminal is invoked from a keybinding', async () => {
    const context = createContext();
    const selectedTerminal = { terminal: { sessionName: 's', windowName: 'zsh' } };

    await activate(context as never);
    vscodeState.treeViewSelection = [selectedTerminal];
    const registration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.killTerminal',
    );
    if (!registration) throw new Error('missing deck.killTerminal registration');
    await registration[1]();

    expect(vscodeState.terminalRemovalRun).toHaveBeenCalledWith(selectedTerminal);
  });

  it('registers deck.terminal.find', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscodeState.registerCommand).toHaveBeenCalledWith(
      'deck.terminal.find',
      expect.any(Function),
    );
  });

  it('refreshes without killing tmux when a Deck custom-editor tab is disposed', async () => {
    const context = createContext();
    let disposePanel: (() => void) | undefined;
    const panel = {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: unknown) => uri,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn((handler: () => void) => {
        disposePanel = handler;
        return { dispose: vi.fn() };
      }),
      onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
      visible: true,
    };

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].refresh.mockClear();
    const provider = vscodeState.registerCustomEditorProvider.mock.calls[0][1] as {
      openCustomDocument(uri: unknown): unknown;
      resolveCustomEditor(document: unknown, panel: unknown): void;
    };
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/repo/term-1',
    });
    provider.resolveCustomEditor(document, panel);
    disposePanel?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(vscodeState.tmuxInstances[0].killSession).not.toHaveBeenCalled();
    expect(vscodeState.repositoryTreeInstances[0].refresh).toHaveBeenCalledOnce();
  });

  it('registers deck.openTerminalInNewWindow through OpenTerminalInNewWindowCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const openTerminalInNewWindowRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.openTerminalInNewWindow',
    );
    if (!openTerminalInNewWindowRegistration) {
      throw new Error('missing deck.openTerminalInNewWindow registration');
    }
    await openTerminalInNewWindowRegistration[1]({
      terminal: { sessionName: 's', windowName: 'zsh' },
      worktreePath: '/work/repo',
    });

    expect(vscodeState.openTerminalInNewWindowRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
      worktreePath: '/work/repo',
    });
  });

  it('consumes a pending terminal for the current worktree and opens it as a Deck custom editor', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => 'wt-_work_alpha-main__term-1'),
    };
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/alpha-main/term-1',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
  });

  it('reveals an already-restored pending terminal in its own group, not the active one', async () => {
    // VS Code natively restored this terminal in editor group 2 on switch-back.
    vscodeState.tabGroups = [
      { viewColumn: 1, tabs: [] },
      {
        viewColumn: 2,
        tabs: [
          {
            input: {
              viewType: 'deck.terminal',
              uri: {
                scheme: 'deck-terminal',
                path: '/work/alpha-main/term-1',
              },
            },
          },
        ],
      },
    ];
    const pendingTerminalOpens = { consume: vi.fn(async () => 'wt-_work_alpha-main__term-1') };
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };

    await openPendingTerminalForCurrentWorktree(pendingTerminalOpens, tmux);

    // Reveal in its restored group (2), not ViewColumn.Active (-1), which would
    // yank the tab to the last-focused group.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      expect.anything(),
      'deck.terminal',
      { viewColumn: 2 },
    );
  });

  it('does nothing when no pending terminal intent matches the current worktree', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => undefined),
    };
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(tmux.listSessions).not.toHaveBeenCalled();
    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
  });

  it('consumes the pending intent without opening when the target session has vanished', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => 'wt-_work_alpha-main__term-1'),
    };
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
    expect(tmux.listSessions).toHaveBeenCalledWith('wt-_work_alpha-main__term-');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('ignores expired pending terminal intents on activation', async () => {
    const values: Record<string, unknown> = {};
    const now = vi.fn(() => 1_000);
    const pendingTerminalOpens = new PendingTerminalOpenStore(
      {
        get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
        update: async (key: string, value: unknown) => {
          values[key] = value;
        },
      },
      now,
    );
    await pendingTerminalOpens.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');
    now.mockReturnValue(61_001);
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(tmux.listSessions).not.toHaveBeenCalled();
  });

});
