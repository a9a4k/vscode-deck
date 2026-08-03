import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { listWorktrees } from './git/worktrees';
import { RepositoryTreeProvider, type RepositoryTreeNode } from './tree/repositoryTree';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { DetachedOpener } from './switch/detachedOpener';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { AddRepositoryCommand, VsCodeRepositoryFolderPicker } from './repository/addRepositoryCommand';
import { RepositoryRemovalCommand } from './repository/repositoryRemovalCommand';
import { ExternalGitWatch } from './repository/externalGitWatch';
import { RepositoryCommonDirCache, resolveCommonDirSafe } from './repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from './repository/repositoryRegistryStore';
import { watchGitCommonDir } from './repository/vscodeExternalGitWatch';
import { AddWorktreeCommand } from './worktree/addWorktreeCommand';
import { BranchDeletionPreferenceStore } from './worktree/branchDeletionPreferenceStore';
import { WorktreeListCacheStore } from './worktree/worktreeListCacheStore';
import { WorktreeRemovalCommand } from './worktree/worktreeRemovalCommand';
import { WorktreeRootStore } from './worktree/worktreeRootStore';
import { WorktreeReconciler } from './worktree/worktreeReconciler';
import {
  DeckTreeDragAndDropController,
  type TreeRefreshScope,
} from './tree/deckTreeDragAndDropController';
import { WorktreeOrderStore } from './worktree/worktreeOrderStore';
import { AddTerminalCommand } from './terminal/addTerminalCommand';
import { RunLauncherCommand } from './terminal/runLauncherCommand';
import { WorktreeCreateLauncherRunner } from './terminal/worktreeCreateLauncherRunner';
import { TerminalRemovalCommand } from './terminal/killTerminalCommand';
import { OpenTerminalCommand } from './terminal/openTerminalCommand';
import { OpenTerminalInNewWindowCommand } from './terminal/openTerminalInNewWindowCommand';
import { PendingTerminalOpenStore } from './terminal/pendingTerminalOpenStore';
import { TerminalCascade } from './terminal/terminalCascade';
import { TerminalOrderStore } from './terminal/terminalOrderStore';
import {
  TerminalEditorProvider,
  terminalEditorViewType,
} from './terminal/terminalEditorProvider';
import { DisconnectedTabWatch } from './terminal/disconnectedTabWatch';
import { TmuxCli, type TmuxSession } from './terminal/tmuxCli';
import { terminalSessionNumber, terminalSessionPrefix } from './terminal/tmuxSafe';
import { tmuxPreflight } from './terminal/tmuxPreflight';
import { SessionUriCodec } from './terminal/sessionUriCodec';
import { renderDeckConf } from './terminal/deckConf';
import { resolveDeckTmuxOptions, type DeckTmuxOptions } from './terminal/deckTmuxOptions';
import {
  TERMINAL_SNAPSHOT_ANCHOR_SESSION,
  TerminalSnapshotRuntime,
} from './terminal/terminalSnapshotRuntime';
import {
  formatTerminalSnapshotRestoreProgress,
  terminalSnapshotLastSaveTime,
  type TerminalSnapshotRestoreFeedback,
} from './terminal/terminalSnapshotRestoreFeedback';
import { createRestoreCoordinator } from './terminal/restoreGate';
import { deckSocketPath, WedgeRecovery } from './terminal/deckSocketRecovery';
import { SNAPSHOT_LOCK_FILENAME, RecoveryLock } from './terminal/recoveryLock';
import { AgentSidecarStore } from './agent/agentSidecarStore';
import { AgentExitSweep } from './agent/agentExitSweep';
import { PsProcessProbe } from './agent/agentLivenessProbe';
import { AgentPaneProbe } from './agent/agentPaneProbe';
import { DeckDecorationProvider } from './tree/deckDecorationProvider';
import { AgentStatusNotifier } from './agent/agentStatusNotifier';
import { AgentStatusStore } from './agent/agentStatusStore';
import { TerminalPoll } from './terminal/terminalPoll';
import { TerminalModel } from './terminal/terminalModel';
import { TerminalReconciler, type TerminalLocation } from './terminal/terminalReconciler';
import type { AgentName } from './agent/agentTypes';
import { AgentDetection } from './agent/agentDetection';
import { AgentSetupPrompt, type AgentConfigChange } from './agent/agentSetupPrompt';
import { HookInstaller, type HookReconcileResult } from './agent/hookInstaller';
import { rewriteTerminalSnapshotAgentSessions } from './agent/terminalSnapshotAgentSessions';
import { ResumeTemplate } from './agent/resumeTemplate';
import { SnapshotRewriter } from './agent/snapshotRewriter';

let terminalSnapshotRuntime: TerminalSnapshotRuntime | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tmuxAvailability = await tmuxPreflight();
  await vscode.commands.executeCommand('setContext', 'deck.tmuxAvailable', tmuxAvailability.available);
  const initialTmuxOptions = deckTmuxOptionsFromSettings();
  showDeckTmuxOptionWarnings(initialTmuxOptions);
  const tmuxConfigPath = await writeDeckConf(context, initialTmuxOptions);
  const tmux = new TmuxCli(tmuxConfigPath);
  await applyDeckTmuxOptionsIfServerRunning(tmux, initialTmuxOptions, tmuxAvailability.available);
  const deckDir = deckDataDir();
  let treeView: vscode.TreeView<RepositoryTreeNode> | undefined;
  const agentSidecars = new AgentSidecarStore(join(deckDir, 'hooks'));
  const agentStatuses = new AgentStatusStore(join(deckDir, 'status'), 100);
  const agentStatusWatch = await agentStatuses.start();
  const resolveAgentName = async (sessionName: string): Promise<AgentName | undefined> => {
    const status = agentStatuses.get(sessionName);
    if (status !== undefined) return status.agent ?? 'claude';

    try {
      return (await agentSidecars.read(sessionName))?.agent;
    } catch {
      return undefined;
    }
  };
  let agentExitSweep: AgentExitSweep | undefined;
  let terminalPoll: TerminalPoll | undefined;
  let agentExitSweepReady = false;
  const wakeAgentExitSweep = () => {
    if (!agentExitSweepReady) return;
    agentExitSweep?.wake();
  };
  const startAgentExitSweep = () => {
    agentExitSweepReady = true;
    agentExitSweep?.wake();
  };
  const activeTerminalReadWatch = agentStatuses.onDidChange(() => {
    void markActiveTerminalRead(agentStatuses);
  });
  const agentExitSweepWakeWatch = agentStatuses.onDidChange(() => {
    wakeAgentExitSweep();
  });
  void markActiveTerminalRead(agentStatuses);
  const hookInstaller = new HookInstaller({
    claudeSettingsPath: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
    codexHooksPath: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json'),
    hookScriptPath: join(deckDir, 'bin', 'deck-claude-hook.sh'),
    codexHookScriptPath: join(deckDir, 'bin', 'deck-codex-hook.sh'),
    sidecarDir: join(deckDir, 'hooks'),
  });
  const agentSetupPrompt = new AgentSetupPrompt({
    detector: new AgentDetection(),
    installer: hookInstaller,
    globalState: context.globalState,
    notifications: vscode.window,
    reviewer: {
      showChanges: showAgentHookConfigChanges,
    },
  });

  terminalSnapshotRuntime = tmuxAvailability.available
    ? new TerminalSnapshotRuntime(
        tmux,
        () => terminalSnapshotSaveScriptPath(context),
        () => terminalSnapshotRestoreScriptPath(context),
        () => deckDir,
        () => rewriteTerminalSnapshotAgentSessions(
          join(deckDir, 'resurrect', 'last'),
          agentSidecars,
          new SnapshotRewriter(resumeTemplateFromSettings()),
        ),
        new WedgeRecovery({
          isServerRunning: () => tmux.isServerRunning(),
          startServer: () => tmux.newAnchorSession(TERMINAL_SNAPSHOT_ANCHOR_SESSION, deckDir),
          socketPath: () => deckSocketPath(),
          socketExists,
          removeSocket: (path) => rm(path, { force: true }),
          recoveryLock: new RecoveryLock({
            deckDir,
            isHealthy: () => tmux.isServerRunning(),
          }),
        }),
        terminalSnapshotRestoreFeedback(deckDir, () => treeView),
        new RecoveryLock({
          deckDir,
          lockFilename: SNAPSHOT_LOCK_FILENAME,
          isHealthy: () => tmux.isServerRunning(),
        }),
      )
    : undefined;

  // A terminal-tab reattach (which issues `new-session -A`) awaits this gate
  // before touching tmux, so it can never resurrect a session blank ahead of
  // restore — on reopen after reboot, or when the DeckSocket dies while VS Code
  // stays open. See restoreGate.ts.
  const snapshotRuntime = terminalSnapshotRuntime;
  const restoreCoordinator = snapshotRuntime
    ? createRestoreCoordinator({
        listSessions: () => tmux.listSessions(),
        restore: () => snapshotRuntime.restoreOnActivation(),
        restoreLock: new RecoveryLock({
          deckDir,
          lockFilename: SNAPSHOT_LOCK_FILENAME,
          isHealthy: () => tmux.isServerRunning(),
        }),
      })
    : undefined;
  const ensureSnapshotRestored = restoreCoordinator
    ? async () => {
        await restoreCoordinator.ensureRestored();
      }
    : () => Promise.resolve();
  const repositoryRegistry = new RepositoryRegistryStore(context.globalState);

  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const worktreeOrders = new WorktreeOrderStore(context.globalState);
  const terminalOrders = new TerminalOrderStore(context.globalState);
  const terminalModel = new TerminalModel();
  const worktreeListCache = new WorktreeListCacheStore(context.globalState);
  const pendingTerminalOpens = new PendingTerminalOpenStore(context.globalState);
  const pendingWorktreeRemovals = new Set<string>();
  const repositoryCommonDirCache = new RepositoryCommonDirCache(context.globalState);
  const branchDeletionPreferences = new BranchDeletionPreferenceStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const detachedOpener = new DetachedOpener();
  const tree = new RepositoryTreeProvider(
    repositoryRegistry,
    activeWorktrees,
    worktreeOrders,
    worktreeListCache,
    repositoryCommonDirCache,
    terminalModel,
    tmuxAvailability.available,
    pendingWorktreeRemovals,
    agentStatuses,
    terminalOrders,
  );
  let lastRevealedActiveTerminalSessionName: string | undefined;
  const revealActiveTerminalIfNeeded = async (
    newlyObservedTerminals?: readonly { sessionName: string }[],
  ) => {
    const activeTerminal = activeDeckTerminal();
    if (!activeTerminal) {
      lastRevealedActiveTerminalSessionName = undefined;
      return;
    }
    // VS Code also emits tab changes for Deck's agent icon/title churn, not
    // just navigation. Only reselect the tree row when the active Terminal
    // identity changes, so status/title updates don't steal manual selection.
    if (activeTerminal.sessionName === lastRevealedActiveTerminalSessionName) return;
    if (
      newlyObservedTerminals !== undefined
      && !newlyObservedTerminals.some(({ sessionName }) => sessionName === activeTerminal.sessionName)
    ) return;
    if (!treeView) return;
    const revealed = await revealActiveTerminalInTree(tree, treeView);
    if (revealed) lastRevealedActiveTerminalSessionName = activeTerminal.sessionName;
  };
  const terminalReconciler = new TerminalReconciler({
    model: terminalModel,
    restoreTerminalSnapshot: ensureSnapshotRestored,
    terminalOrders,
    listTerminalLocations: () => terminalLocations(
      repositoryRegistry,
      repositoryCommonDirCache,
      worktreeListCache,
      pendingWorktreeRemovals,
    ),
    updateTerminalDecorations: (terminals) => tree.updateTerminalDecorations(terminals),
    wakeAgentExitSweep,
    refreshWorktree: (worktreePath) => tree.refreshWorktree(worktreePath),
    refreshTerminalDisplays: (sessions) => tree.refreshTerminalDisplays(sessions),
    onDidAddTerminals: (terminals) => revealActiveTerminalIfNeeded(terminals),
  });
  const worktreeReconciler = new WorktreeReconciler({
    repositories: repositoryRegistry,
    commonDirs: {
      get: (repositoryPath) => repositoryCommonDirCache.get(repositoryPath),
      resolve: (repositoryPath) =>
        resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
    },
    worktreeListCache,
    worktreeOrders,
    listWorktrees,
    activeWorktreePath: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    refreshRepository: (repositoryPath) => tree.refreshRepository(repositoryPath),
    pendingWorktreeRemovals,
  });
  const reconcileRepositoryWorktrees = async (repositoryPath: string): Promise<void> => {
    await worktreeReconciler.reconcile(repositoryPath).catch((error) => {
      console.warn(`Deck: reconciling Worktrees for ${repositoryPath} failed`, error);
    });
  };
  agentExitSweep = tmuxAvailability.available
    ? new AgentExitSweep({
        sidecars: agentSidecars,
        statuses: agentStatuses,
        teardown: tmux,
        serverStart: tmux,
        paneProbe: new AgentPaneProbe(tmux, new PsProcessProbe()),
        paneCapture: tmux,
        onError: (error) => console.warn('Deck: agent exit sweep failed', error),
      })
    : undefined;
  const externalGitWatch = new ExternalGitWatch(
    watchGitCommonDir,
    (commonDir) => {
      void worktreeReconciler.reconcileCommonDir(commonDir).catch((error) => {
        console.warn('Deck: reconciling external Git change failed', error);
      });
    },
  );
  let externalGitSyncVersion = 0;

  function refreshTree(scope?: TreeRefreshScope): void {
    if (scope === undefined) {
      tree.refresh();
    } else if (scope.worktreePath !== undefined) {
      tree.refreshWorktree(scope.worktreePath);
    } else {
      tree.refreshRepository(scope.repositoryPath);
    }
    terminalPoll?.start();
    syncExternalGitWatches();
  }

  function syncExternalGitWatches(): void {
    const version = ++externalGitSyncVersion;
    void registeredCommonDirs(repositoryRegistry, repositoryCommonDirCache).then((commonDirs) => {
      if (version !== externalGitSyncVersion) return;
      externalGitWatch.sync(commonDirs);
    });
  }

  syncExternalGitWatches();
  void worktreeReconciler.reconcileAll().catch((error) => {
    console.warn('Deck: reconciling Worktrees during activation failed', error);
  });

  const worktreeCreateLaunchers = new WorktreeCreateLauncherRunner(tmux, {
    wakePoll: () => terminalPoll?.wake(),
    beforeCreate: ensureSnapshotRestored,
    resolveCommonDir: (repositoryPath) =>
      resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
  });
  const terminalEditorProvider = new TerminalEditorProvider(
    context.extensionUri,
    tmuxConfigPath,
    undefined,
    undefined,
    () => terminalPoll?.wake(),
    // A control-client rename requests an immediate observation so the
    // TerminalPoll remains the TerminalModel's only writer.
    () => terminalPoll?.wake(),
    (sessionName) => tmux.terminalSession(sessionName),
    ensureSnapshotRestored,
    resolveAgentName,
  );
  const focusTerminal = (sessionName: string) =>
    terminalEditorProvider.focusTerminal(sessionName);
  const addTerminal = new AddTerminalCommand(
    tmux,
    () => terminalPoll?.wake(),
    undefined,
    ensureSnapshotRestored,
    focusTerminal,
  );
  const runLauncher = new RunLauncherCommand(tmux, {
    wakePoll: () => terminalPoll?.wake(),
    focusTerminal,
    beforeCreate: ensureSnapshotRestored,
    resolveCommonDir: (repositoryPath) =>
      resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
  });
  const disconnectedTabs = new DisconnectedTabWatch({
    panelFor: (sessionName) => terminalEditorProvider.panelFor(sessionName),
  });
  terminalPoll = tmuxAvailability.available
    ? new TerminalPoll({
        listSessions: () => tmux.listSessions(),
        reconcileObservation: (sessions) => terminalReconciler.reconcile(sessions),
        isFocused: () => vscode.window.state.focused,
        onDidChangeFocus: (listener) =>
          vscode.window.onDidChangeWindowState((state) => listener(state.focused)),
        onError: (error) => console.warn('Deck: terminal poll failed', error),
        resolveAgentName,
      })
    : undefined;
  const terminalLabelWatch = terminalPoll?.onDidChangeLabels((changedSessions) => {
    terminalEditorProvider.refreshTitles(changedSessions.map((session) => session.sessionName));
  });
  terminalPoll?.start();
  const openTerminal = new OpenTerminalCommand({
    terminalPanels: terminalEditorProvider,
  });
  const openTerminalInNewWindow = new OpenTerminalInNewWindowCommand(pendingTerminalOpens);
  const removeAgentStatus = (sessionName: string) => agentStatuses.remove(sessionName);
  const terminalRemoval = new TerminalRemovalCommand(
    tmux,
    () => terminalPoll?.wake(),
    confirmTerminalRemoval,
    undefined,
    removeAgentStatus,
  );
  const terminalCascade = new TerminalCascade(tmux, undefined, removeAgentStatus);
  const addWorktree = new AddWorktreeCommand(
    switcher,
    detachedOpener,
    reconcileRepositoryWorktrees,
    worktreeRoots,
    repositoryCommonDirCache,
    worktreeCreateLaunchers,
  );
  const revealRepository = async (repositoryPath: string) => {
    const roots = tree.getChildren();
    if (!Array.isArray(roots)) return;
    const repository = roots.find((node) => 'repositoryPath' in node && node.repositoryPath === repositoryPath);
    if (!repository) return;
    try {
      await treeView?.reveal(repository, { expand: true, select: true });
    } catch (error) {
      console.warn('Deck: TreeView.reveal failed', error);
    }
  };
  const dragAndDropController = new DeckTreeDragAndDropController(
    refreshTree,
    repositoryRegistry,
    worktreeOrders,
    terminalOrders,
    tmux,
    activeWorktrees,
    switcher,
    detachedOpener,
    revealRepository,
    repositoryCommonDirCache,
  );
  const removeWorktree = new WorktreeRemovalCommand(
    activeWorktrees,
    reconcileRepositoryWorktrees,
    branchDeletionPreferences,
    repositoryCommonDirCache,
    terminalCascade,
    pendingWorktreeRemovals,
  );
  const removeRepository = new RepositoryRemovalCommand(
    repositoryRegistry,
    activeWorktrees,
    worktreeRoots,
    worktreeOrders,
    refreshTree,
    terminalCascade,
    worktreeListCache,
  );

  treeView = vscode.window.createTreeView('deck.repositories', {
    treeDataProvider: tree,
    dragAndDropController,
    canSelectMany: false,
  });
  const deckDecorationProvider = new DeckDecorationProvider(
    agentStatuses,
    tree.agentStatusDecorationRollups,
    {
      isActiveRepository: (id) => tree.isActiveRepositoryDecorationTarget(id),
      isActiveWorktree: (id) => tree.isActiveWorktreeDecorationTarget(id),
      onDidChange: (listener) => tree.onDidChangeDeckDecorations(listener),
    },
    disconnectedTabs,
  );
  const deckDecorationWatch = vscode.window.registerFileDecorationProvider(deckDecorationProvider);
  const disconnectedTabBadgeWatch = disconnectedTabs.onDidChangeDisconnectedTabs((uris) => {
    deckDecorationProvider.invalidate(uris);
  });
  const agentStatusCollapseWatch = treeView.onDidCollapseElement((event) => {
    deckDecorationProvider.fire(tree.setCollapsed(event.element, true));
  });
  const agentStatusExpandWatch = treeView.onDidExpandElement((event) => {
    deckDecorationProvider.fire(tree.setCollapsed(event.element, false));
  });
  // Kick off the reboot restore after the tree view exists so restore feedback
  // can show the sidebar banner while the snapshot is being restored.
  const activationRestore = restoreCoordinator?.ensureRestored();
  if (activationRestore) {
    void activationRestore
      .then(() => terminalPoll?.wake())
      .catch((error) => {
        console.warn('Deck: restoring TerminalSnapshot during activation failed', error);
      })
      .finally(startAgentExitSweep);
  } else {
    startAgentExitSweep();
  }
  const agentStatusNotifierWatch = new AgentStatusNotifier({
    store: agentStatuses,
    settings: {
      notifyOnNeedsInput: () => agentStatusNotificationEnabled('notifyOnNeedsInput'),
      notifyOnCompleted: () => agentStatusNotificationEnabled('notifyOnCompleted'),
    },
    windowState: {
      isFocused: () => vscode.window.state.focused,
      activeTerminalSessionName: () => activeDeckTerminal()?.sessionName,
    },
    notifications: {
      showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
      showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    },
    openTerminal: (sessionName) => openAgentStatusTerminal(
      tree,
      treeView,
      openTerminal,
      terminalModel,
      tmux,
      sessionName,
    ),
    resolveTerminalSession: async (sessionName) =>
      terminalModel.find(sessionName) ?? await tmux.terminalSession(sessionName),
    describeSession: (sessionName) => tree.describeSession(sessionName),
  }).start();
  const addRepository = new AddRepositoryCommand(
    new VsCodeRepositoryFolderPicker(),
    repositoryRegistry,
    activeWorktrees,
    switcher,
    detachedOpener,
    async () => {
      await worktreeReconciler.reconcileAll().catch((error) => {
        console.warn('Deck: reconciling Worktrees after adding a Repository failed', error);
      });
      refreshTree();
    },
    revealRepository,
    repositoryCommonDirCache,
  );

  context.subscriptions.push(
    treeView,
    agentStatusWatch,
    activeTerminalReadWatch,
    agentExitSweepWakeWatch,
    ...(agentExitSweep ? [agentExitSweep] : []),
    ...(terminalPoll ? [terminalPoll] : []),
    ...(terminalLabelWatch ? [terminalLabelWatch] : []),
    deckDecorationProvider,
    deckDecorationWatch,
    disconnectedTabBadgeWatch,
    agentStatusCollapseWatch,
    agentStatusExpandWatch,
    agentStatusNotifierWatch,
    externalGitWatch,
    vscode.window.registerCustomEditorProvider(terminalEditorViewType, terminalEditorProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
    terminalEditorProvider,
    disconnectedTabs,
    vscode.commands.registerCommand('deck.refresh', async () => {
      await worktreeReconciler.reconcileAll().catch((error) => {
        console.warn('Deck: reconciling Worktrees during manual refresh failed', error);
      });
      refreshTree();
      terminalPoll?.wake();
    }),
    vscode.commands.registerCommand('deck.addRepository', () => addRepository.run()),
    vscode.commands.registerCommand('deck.addWorktree', (node) => addWorktree.run(node)),
    vscode.commands.registerCommand('deck.addTerminal', (node) => addTerminal.run(node)),
    vscode.commands.registerCommand('deck.runLauncher', (node) => runLauncher.run(node)),
    vscode.commands.registerCommand('deck.openTerminal', (node) => openTerminal.run(node)),
    vscode.commands.registerCommand('deck.openTerminalInNewWindow', (node) =>
      openTerminalInNewWindow.run(node),
    ),
    // cmd+backspace (keybinding) passes no node, so fall back to the selected
    // row. Scoped to Terminals only: a Worktree row can't be selected by keyboard
    // without switching (its click reloads the window), and VS Code gives no API
    // to read the keyboard-focused tree item (microsoft/vscode#130880) — so
    // Worktree delete lives in the right-click menu, which does receive the row.
    vscode.commands.registerCommand('deck.killTerminal', (node) =>
      terminalRemoval.run(node ?? treeView.selection[0]),
    ),
    vscode.commands.registerCommand('deck.terminal.find', () => terminalEditorProvider.showFind()),
    vscode.commands.registerCommand('deck.reopenTerminals', () => disconnectedTabs.reopenUnwiredTabs()),
    vscode.commands.registerCommand('deck.installAgentHooks', () => agentSetupPrompt.run({ explicit: true })),
    vscode.commands.registerCommand('deck.removeAgentHooks', () => agentSetupPrompt.uninstall()),
    vscode.commands.registerCommand('deck.removeRepository', (node) => removeRepository.run(node)),
    vscode.commands.registerCommand('deck.removeWorktree', (node) => removeWorktree.run(node)),
    vscode.commands.registerCommand('deck.openWorktreeInNewWindow', (node: { worktree: { path: string } }) =>
      detachedOpener.open(node.worktree.path),
    ),
    vscode.commands.registerCommand('deck.switchWorktree', async (node: { worktree: { path: string } }) => {
      await switcher.switchTo(node.worktree.path);
      tree.refreshWorkspaceFolders();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refreshWorkspaceFolders()),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('deck.tmux')) return;
      const tmuxOptions = deckTmuxOptionsFromSettings();
      showDeckTmuxOptionWarnings(tmuxOptions);
      await writeDeckConf(context, tmuxOptions);
      await applyDeckTmuxOptionsIfServerRunning(tmux, tmuxOptions, tmuxAvailability.available);
    }),
    vscode.window.tabGroups.onDidChangeTabs(async () => {
      await markActiveTerminalRead(agentStatuses);
      await revealActiveTerminalIfNeeded();
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(async () => {
      await markActiveTerminalRead(agentStatuses);
      await revealActiveTerminalIfNeeded();
    }),
    // Focusing back with the agent's tab active is when you actually read it —
    // markActiveTerminalRead no-ops while unfocused, so re-run it on refocus.
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) return;
      void markActiveTerminalRead(agentStatuses);
    }),
    treeView.onDidChangeVisibility(async (event) => {
      if (!event.visible) return;
      await worktreeReconciler.reconcileAll().catch((error) => {
        console.warn('Deck: reconciling Worktrees when showing the tree failed', error);
      });
      refreshTree();
    }),
  );
  disconnectedTabs.start();
  if (terminalSnapshotRuntime) {
    context.subscriptions.push(terminalSnapshotRuntime.startPeriodicSave(5 * 60 * 1000));
    await openPendingTerminalForCurrentWorktree(pendingTerminalOpens, tmux);
    await activationRestore?.catch(() => undefined);
    hookInstaller.reconcileInstalledHooks().then(showAgentHookUpgradeNotifications).catch((error) =>
      console.warn('Deck: reconciling agent hooks failed', error),
    );
    // Agent resume rides on the tmux-backed snapshot machinery, so only offer
    // setup when that's available.
    void agentSetupPrompt.run();
  }
}

export function deactivate(): Promise<void> | undefined {
  const runtime = terminalSnapshotRuntime;
  terminalSnapshotRuntime = undefined;

  // Returned so VS Code awaits the final save within its shutdown budget;
  // still best-effort — a hard crash never calls deactivate at all.
  return runtime?.save().catch((error) => {
    console.warn('Deck: saving TerminalSnapshot during deactivate failed', error);
  });
}

async function writeDeckConf(
  context: vscode.ExtensionContext,
  tmuxOptions: DeckTmuxOptions = deckTmuxOptionsFromSettings(),
): Promise<string> {
  const templatePath = join(context.extensionPath, 'resources', 'deck.conf');
  const dataDir = deckDataDir();
  const generatedPath = join(dataDir, 'deck.conf');
  const resurrectDir = join(dataDir, 'resurrect');
  const pluginPath = tmuxResurrectPath(context, 'resurrect.tmux');

  const template = await readFile(templatePath, 'utf8');
  // resurrectDir is under dataDir, so this creates both.
  await mkdir(resurrectDir, { recursive: true });
  await writeFile(generatedPath, renderDeckConf(template, { pluginPath, resurrectDir }, tmuxOptions), 'utf8');
  return generatedPath;
}

async function socketExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function deckTmuxOptionsFromSettings(): DeckTmuxOptions {
  const config = vscode.workspace.getConfiguration('deck.tmux');
  return resolveDeckTmuxOptions({
    automaticRenameFormat: config.get<string>('automaticRenameFormat'),
  });
}

function showDeckTmuxOptionWarnings(tmuxOptions: DeckTmuxOptions): void {
  for (const warning of tmuxOptions.warnings) {
    void vscode.window.showWarningMessage(warning);
  }
}

async function applyDeckTmuxOptionsIfServerRunning(
  tmux: TmuxCli,
  tmuxOptions: DeckTmuxOptions,
  tmuxAvailable: boolean,
): Promise<void> {
  try {
    if (!tmuxAvailable || !(await tmux.isServerRunning())) return;

    for (const option of tmuxOptions.options) {
      if (option.value === null) await tmux.unsetOption(option.option);
      else await tmux.setOption(option.option, option.value);
    }
  } catch (error) {
    console.warn('Deck: applying tmux options failed', error);
  }
}

function terminalSnapshotSaveScriptPath(context: vscode.ExtensionContext): string {
  return tmuxResurrectPath(context, 'scripts', 'save.sh');
}

function terminalSnapshotRestoreScriptPath(context: vscode.ExtensionContext): string {
  return tmuxResurrectPath(context, 'scripts', 'restore.sh');
}

function tmuxResurrectPath(context: vscode.ExtensionContext, ...parts: string[]): string {
  return join(context.extensionPath, 'resources', 'plugins', 'tmux-resurrect', ...parts);
}

function terminalSnapshotRestoreFeedback(
  deckDir: string,
  currentTreeView: () => vscode.TreeView<RepositoryTreeNode> | undefined,
): TerminalSnapshotRestoreFeedback {
  return {
    withProgress: async (context, task) => {
      const treeView = currentTreeView();
      if (treeView) treeView.message = 'Restoring terminals…';
      try {
        const copy = formatTerminalSnapshotRestoreProgress({
          unresponsive: context.unresponsive,
          lastSavedAt: await terminalSnapshotLastSaveTime(deckDir),
        });
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: copy.title,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: copy.message });
            await task();
          },
        );
      } finally {
        if (treeView) treeView.message = undefined;
      }
    },
  };
}

// Deck's machine-global runtime dir, holding the generated DeckSocket conf and
// the TerminalSnapshot. Deliberately NOT globalStorage: the DeckSocket
// (`-L deck`) is one tmux server per user, but globalStorage is per-install
// (VS Code Stable and Insiders would generate competing conf/snapshots for the
// one shared socket) and, on macOS, lives under "~/Library/Application
// Support/…" whose space breaks tmux-resurrect's restore.sh. A space-free
// machine-global dir matches the machine-global socket. Isolated from the
// user's own ~/.local/share/tmux/resurrect.
function deckDataDir(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'deck');
}

function resumeTemplateFromSettings(): ResumeTemplate {
  const config = vscode.workspace.getConfiguration('deck');
  return new ResumeTemplate({
    claude: config.get<string>('agentResumeTemplates.claude'),
    codex: config.get<string>('agentResumeTemplates.codex'),
  });
}

function agentStatusNotificationEnabled(key: 'notifyOnNeedsInput' | 'notifyOnCompleted'): boolean {
  return vscode.workspace.getConfiguration('deck').get<boolean>(key, true);
}

interface RepositoryRegistryReader {
  list(): readonly string[];
}

function terminalLocations(
  repositoryRegistry: RepositoryRegistryReader,
  repositoryCommonDirCache: Pick<RepositoryCommonDirCache, 'get'>,
  worktreeListCache: Pick<WorktreeListCacheStore, 'get'>,
  pendingWorktreeRemovals: ReadonlySet<string>,
): TerminalLocation[] {
  const locations: TerminalLocation[] = [];
  for (const repositoryPath of repositoryRegistry.list()) {
    const commonDir = repositoryCommonDirCache.get(repositoryPath);
    if (commonDir === undefined) continue;
    const worktrees = worktreeListCache.get(commonDir);
    if (worktrees === undefined) continue;
    for (const worktree of worktrees) {
      if (worktree.bare || pendingWorktreeRemovals.has(worktree.path)) continue;
      locations.push({ repositoryPath, worktreePath: worktree.path });
    }
  }
  return locations;
}

async function registeredCommonDirs(
  repositoryRegistry: RepositoryRegistryReader,
  repositoryCommonDirCache: RepositoryCommonDirCache,
): Promise<Set<string>> {
  const commonDirs = await Promise.all(
    repositoryRegistry.list().map((repositoryPath) =>
      resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
    ),
  );
  return new Set(commonDirs.filter((commonDir): commonDir is string => commonDir !== null));
}

async function showAgentHookUpgradeNotifications(configs: readonly HookReconcileResult[]): Promise<void> {
  // Unchained: an ignored toast's promise stays pending until dismissed, so a
  // sequential loop could hold back the next agent's toast indefinitely.
  await Promise.all(configs.map(async (config) => {
    const reviewChanges = 'Review Changes';
    const choice = await vscode.window.showInformationMessage(
      `Deck updated its ${agentHookProductName(config.agent)} hooks for this Deck version`,
      reviewChanges,
    );
    if (choice === reviewChanges) await showAgentHookConfigChanges([config]);
  }));
}

async function showAgentHookConfigChanges(configs: readonly AgentConfigChange[]): Promise<void> {
  for (const { agent, configPath } of configs) {
    const current = vscode.Uri.file(configPath);
    const backup = vscode.Uri.file(`${configPath}.deck.bak`);
    const title = `Deck ${agent === 'claude' ? 'Claude' : 'Codex'} hooks (before ↔ after)`;
    try {
      await vscode.workspace.fs.stat(backup);
      await vscode.commands.executeCommand('vscode.diff', backup, current, title);
    } catch {
      // No backup (config was absent before) — just open the new file.
      await vscode.window.showTextDocument(current);
    }
  }
}

function agentHookProductName(agent: HookReconcileResult['agent']): string {
  return agent === 'claude' ? 'Claude Code' : 'Codex';
}

// Mirrors the Explorer's delete confirmation (a modal warning gated by a
// setting). The webview API has no in-dialog "do not ask again" checkbox, so
// `deck.confirmTerminalDelete` carries that effect instead.
async function confirmTerminalRemoval(label: string): Promise<boolean> {
  if (vscode.workspace.getConfiguration('deck').get<boolean>('confirmTerminalDelete', true) === false) {
    return true;
  }
  // Information (not warning) so the dialog has no orange warning icon, matching
  // the Explorer's plain delete confirmation.
  const choice = await vscode.window.showInformationMessage(
    `Are you sure you want to delete the terminal '${label}'?`,
    { modal: true, detail: 'The shell and any running process will be terminated.' },
    'Delete',
  );
  return choice === 'Delete';
}

async function revealActiveTerminalInTree(
  tree: RepositoryTreeProvider,
  treeView: vscode.TreeView<RepositoryTreeNode>,
): Promise<boolean> {
  const decoded = activeDeckTerminal();
  if (!decoded) return false;

  let terminalNode: RepositoryTreeNode | undefined;
  try {
    // A tab event must not surface a lookup failure as an unhandled rejection.
    terminalNode = await tree.findTerminal(decoded.sessionName, decoded.worktreePath);
  } catch (error) {
    console.warn('Deck: finding the active terminal failed', error);
    return false;
  }
  if (!terminalNode) return false;

  try {
    await treeView.reveal(terminalNode, { select: true, focus: false });
    return true;
  } catch (error) {
    console.warn('Deck: revealing the active terminal failed', error);
    return false;
  }
}

async function openAgentStatusTerminal(
  tree: RepositoryTreeProvider,
  treeView: vscode.TreeView<RepositoryTreeNode>,
  openTerminal: OpenTerminalCommand,
  terminalModel: TerminalModel,
  tmux: TmuxCli,
  sessionName: string,
): Promise<void> {
  try {
    let terminalNode: RepositoryTreeNode | undefined;
    if (terminalModel.find(sessionName) !== undefined) {
      terminalNode = await tree.findTerminalBySessionName(sessionName);
    } else {
      const liveSession = await tmux.terminalSession(sessionName);
      if (liveSession === undefined) {
        await vscode.window.showInformationMessage('This Terminal is no longer running.');
        return;
      }
      terminalNode = await tree.findTerminalBySessionName(sessionName, liveSession);
    }
    if (!terminalNode || !('terminal' in terminalNode)) {
      // Status files are machine-global; this window's tree only shows
      // registered repositories (e.g. another VS Code install owns this one).
      await vscode.window.showInformationMessage(
        "This Terminal's repository isn't registered in this window. Add the repository to Deck to open it.",
      );
      return;
    }
    await openTerminal.run(terminalNode);
    await treeView.reveal(terminalNode, { select: true, focus: false });
  } catch (error) {
    console.warn('Deck: opening agent status Terminal failed', error);
  }
}

function activeDeckTerminal(): { sessionName: string; worktreePath: string } | undefined {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = activeTab?.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
  if (input?.viewType !== terminalEditorViewType || !input.uri) return undefined;

  try {
    return new SessionUriCodec().decode(input.uri);
  } catch {
    return undefined;
  }
}

async function markActiveTerminalRead(
  agentStatuses: Pick<AgentStatusStore, 'markRead'>,
): Promise<void> {
  // Only "read" when you're actually looking: the window must be focused, not
  // merely have the terminal parked as its active tab. Otherwise a completed
  // turn in a background window's active tab would be marked read everywhere
  // (read state is machine-global), clearing the unread dot you never saw.
  if (!vscode.window.state.focused) return;
  const activeTerminal = activeDeckTerminal();
  if (!activeTerminal) return;

  try {
    await agentStatuses.markRead(activeTerminal.sessionName);
  } catch (error) {
    console.warn('Deck: marking active Terminal agent status read failed', error);
  }
}

interface PendingTerminalOpenConsumer {
  consume(worktreePath: string): Promise<string | undefined>;
}

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

export async function openPendingTerminalForCurrentWorktree(
  pendingTerminalOpens: PendingTerminalOpenConsumer,
  tmux: TerminalSessionLister,
): Promise<void> {
  const worktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!worktreePath) return;

  const sessionName = await pendingTerminalOpens.consume(worktreePath);
  if (!sessionName) return;

  const terminals = await tmux.listSessions(terminalSessionPrefix(worktreePath));
  const terminal = terminals.find((candidate) => candidate.sessionName === sessionName);
  if (!terminal) return;
  const term = terminalSessionNumber(worktreePath, sessionName);
  if (term === 0) return;

  // VS Code natively restores this worktree's terminal tabs in their original
  // groups on switch-back. If the clicked terminal is already a restored tab,
  // reveal it in place — passing ViewColumn.Active would *move* it to the
  // last-focused group. Only a terminal with no tab (session alive, tab closed)
  // opens fresh in the active column.
  const existingColumn = findTerminalTabColumn(sessionName);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    new SessionUriCodec().encode({ worktreePath, term }),
    terminalEditorViewType,
    { viewColumn: existingColumn ?? vscode.ViewColumn.Active },
  );
}

// Scans open tabs (not the provider's panel map, which may not be populated yet
// during post-switch restoration) for a Deck terminal tab matching sessionName.
function findTerminalTabColumn(sessionName: string): vscode.ViewColumn | undefined {
  const codec = new SessionUriCodec();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
      if (input?.viewType !== terminalEditorViewType || !input.uri) continue;
      try {
        if (codec.decode(input.uri).sessionName === sessionName) return group.viewColumn;
      } catch {
        // Not a decodable Deck terminal URI; skip.
      }
    }
  }
  return undefined;
}
