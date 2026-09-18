import * as vscode from 'vscode';
import { planReopenUnwiredTerminalTabs, type ReopenPlanOperation, type ReopenPlanSnapshot } from './reopenPlan';
import { SessionUriCodec, terminalUriScheme } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';

const STARTUP_GRACE_MS = 1000;
const ACTIVATION_GRACE_MS = 500;
const PROMPT_THROTTLE_MS = 30_000;
const REOPEN_LABEL = 'Reopen Terminals';

export interface DisconnectedDeckTab {
  readonly sessionName: string;
  readonly uri: vscode.Uri;
  readonly isActive: boolean;
}

export interface DisconnectedTabWatchSurface {
  activeDeckTabs(): readonly DisconnectedDeckTab[];
  allDeckTabs(): readonly DisconnectedDeckTab[];
  closeTabs(sessionNames: ReadonlySet<string>): Promise<void>;
  onDidChangeTabs(listener: (event: { closedSessionNames: readonly string[] }) => void): vscode.Disposable;
}

interface DisconnectedTabWatchNotifications {
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
}

interface TimerPort {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

interface DisconnectedTabWatchOptions {
  surface?: DisconnectedTabWatchSurface;
  panelFor?: (sessionName: string) => unknown;
  notifications?: DisconnectedTabWatchNotifications;
  timers?: TimerPort;
  reopen?: () => Promise<void>;
  beforeSweep?: () => Promise<void>;
  listSessions?: () => Promise<ReadonlyArray<{ sessionName: string }>>;
}

type PanelLookup = (sessionName: string) => unknown;

export class DisconnectedTabWatch implements vscode.Disposable {
  private readonly surface: DisconnectedTabWatchSurface;
  private readonly panelFor: (sessionName: string) => unknown;
  private readonly notifications: DisconnectedTabWatchNotifications;
  private readonly timers: TimerPort;
  private readonly reopen: () => Promise<void>;
  private readonly beforeSweep: () => Promise<void>;
  private readonly listSessions: (() => Promise<ReadonlyArray<{ sessionName: string }>>) | undefined;
  private readonly disconnected = new Map<string, vscode.Uri>();
  private readonly listeners = new Set<(uris: readonly vscode.Uri[]) => void>();
  private readonly pendingJudgments = new Map<string, unknown>();
  private startupJudgment: unknown;
  private subscriptions: vscode.Disposable[] = [];
  private lastPromptAt = -Infinity;
  private disposed = false;

  constructor(options: DisconnectedTabWatchOptions = {}) {
    this.surface = options.surface ?? new VsCodeDisconnectedTabSurface();
    this.panelFor = options.panelFor ?? (() => undefined);
    this.notifications = options.notifications ?? vscode.window;
    this.timers = options.timers ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    };
    this.reopen = options.reopen ?? (() => reopenUnwiredTerminalTabs(this.panelFor));
    this.beforeSweep = options.beforeSweep ?? (() => Promise.resolve());
    this.listSessions = options.listSessions;
  }

  start(): void {
    if (this.disposed) return;
    this.subscriptions.push(
      this.surface.onDidChangeTabs((event) => this.onTabsChanged(event)),
    );
    this.startupJudgment = this.timers.setTimeout(() => {
      this.startupJudgment = undefined;
      this.judgeActiveDeckTabs();
    }, STARTUP_GRACE_MS);
    void this.closeStaleTabs();
  }

  isDisconnected(sessionName: string): boolean {
    return this.disconnected.has(sessionName);
  }

  onDidChangeDisconnectedTabs(listener: (uris: readonly vscode.Uri[]) => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async reopenUnwiredTabs(): Promise<void> {
    await this.reopen();
  }

  dispose(): void {
    this.disposed = true;
    if (this.startupJudgment) this.timers.clearTimeout(this.startupJudgment);
    this.startupJudgment = undefined;
    for (const handle of this.pendingJudgments.values()) this.timers.clearTimeout(handle);
    this.pendingJudgments.clear();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.listeners.clear();
  }

  private onTabsChanged(event: { closedSessionNames: readonly string[] }): void {
    for (const sessionName of event.closedSessionNames) this.forget(sessionName);

    for (const tab of this.surface.activeDeckTabs()) {
      if (this.panelFor(tab.sessionName)) {
        this.forget(tab.sessionName);
        continue;
      }
      if (this.disconnected.has(tab.sessionName)) continue;
      this.scheduleJudgment(tab.sessionName);
    }
  }

  private async closeStaleTabs(): Promise<void> {
    if (!this.listSessions) return;

    try {
      await this.beforeSweep();
      const liveSessionNames = new Set(
        (await this.listSessions()).map((session) => session.sessionName),
      );
      const staleSessionNames = new Set(
        this.surface.allDeckTabs()
          .map((tab) => tab.sessionName)
          .filter((sessionName) => !liveSessionNames.has(sessionName)),
      );
      if (staleSessionNames.size > 0) await this.surface.closeTabs(staleSessionNames);
    } catch {
      return;
    }
  }

  private scheduleJudgment(sessionName: string): void {
    this.cancelJudgment(sessionName);
    const handle = this.timers.setTimeout(() => {
      this.pendingJudgments.delete(sessionName);
      this.judgeActiveDeckTab(sessionName);
    }, ACTIVATION_GRACE_MS);
    this.pendingJudgments.set(sessionName, handle);
  }

  private judgeActiveDeckTabs(): void {
    for (const tab of this.surface.activeDeckTabs()) {
      this.judgeDeckTab(tab);
    }
  }

  private judgeActiveDeckTab(sessionName: string): void {
    const tab = this.surface.activeDeckTabs()
      .find((candidate) => candidate.sessionName === sessionName);
    if (tab === undefined) return;
    this.judgeDeckTab(tab);
  }

  private judgeDeckTab(tab: DisconnectedDeckTab): void {
    if (this.panelFor(tab.sessionName)) {
      this.forget(tab.sessionName);
      return;
    }
    this.markDisconnected(tab.sessionName, tab.uri);
  }

  private markDisconnected(sessionName: string, uri: vscode.Uri): void {
    if (this.disconnected.has(sessionName)) return;
    this.disconnected.set(sessionName, uri);
    this.fire([uri]);
    this.offerReopen();
  }

  private forget(sessionName: string): void {
    const uri = this.disconnected.get(sessionName);
    this.cancelJudgment(sessionName);
    if (uri === undefined) return;
    this.disconnected.delete(sessionName);
    this.fire([uri]);
  }

  private cancelJudgment(sessionName: string): void {
    const handle = this.pendingJudgments.get(sessionName);
    if (handle) this.timers.clearTimeout(handle);
    this.pendingJudgments.delete(sessionName);
  }

  private offerReopen(): void {
    const now = this.timers.now();
    if (now - this.lastPromptAt < PROMPT_THROTTLE_MS) return;
    this.lastPromptAt = now;
    void this.notifications
      .showWarningMessage(
        'Deck Terminal tabs were disconnected by an extension restart.',
        REOPEN_LABEL,
      )
      .then((choice) => {
        if (choice === REOPEN_LABEL) void this.reopenUnwiredTabs();
      });
  }

  private fire(uris: readonly vscode.Uri[]): void {
    if (uris.length === 0) return;
    for (const listener of this.listeners) listener(uris);
  }
}

export async function reopenUnwiredTerminalTabs(panelFor: PanelLookup = () => undefined): Promise<void> {
  const surface = new VsCodeDisconnectedTabSurface();
  const snapshot = surface.reopenSnapshot((sessionName) => panelFor(sessionName) === undefined);
  const operations = planReopenUnwiredTerminalTabs(snapshot);
  const tabsById = surface.tabsById();

  for (const operation of operations) {
    await executeReopenOperation(operation, tabsById);
  }
}

async function executeReopenOperation(
  operation: ReopenPlanOperation,
  tabsById: Map<string, vscode.Tab>,
): Promise<void> {
  switch (operation.kind) {
    case 'close': {
      const tab = tabsById.get(operation.tabId);
      if (tab) await vscode.window.tabGroups.close(tab, true);
      return;
    }
    case 'open':
      await vscode.commands.executeCommand(
        'vscode.openWith',
        operation.uri,
        terminalEditorViewType,
        { viewColumn: operation.viewColumn },
      );
      return;
    case 'move':
      await moveActiveEditorToIndex(operation.index);
      return;
    case 'pin':
      await vscode.commands.executeCommand('workbench.action.pinEditor');
      return;
    case 'reveal':
      if (operation.viewType) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          operation.uri,
          operation.viewType,
          { viewColumn: operation.viewColumn },
        );
        return;
      }

      await vscode.commands.executeCommand(
        'vscode.open',
        operation.uri,
        { viewColumn: operation.viewColumn },
      );
  }
}

async function moveActiveEditorToIndex(index: number): Promise<void> {
  await vscode.commands.executeCommand('moveActiveEditor', { to: 'left', by: 'tab', value: 999 });
  if (index > 0) {
    await vscode.commands.executeCommand('moveActiveEditor', { to: 'right', by: 'tab', value: index });
  }
}

class VsCodeDisconnectedTabSurface implements DisconnectedTabWatchSurface {
  private readonly codec = new SessionUriCodec();

  activeDeckTabs(): readonly DisconnectedDeckTab[] {
    return this.deckTabs().filter((tab) => tab.isActive);
  }

  allDeckTabs(): readonly DisconnectedDeckTab[] {
    return this.deckTabs();
  }

  async closeTabs(sessionNames: ReadonlySet<string>): Promise<void> {
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        const decoded = this.decodeDeckTab(tab);
        return decoded !== undefined && sessionNames.has(decoded.sessionName);
      });
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs, true);
  }

  onDidChangeTabs(listener: (event: { closedSessionNames: readonly string[] }) => void): vscode.Disposable {
    return vscode.window.tabGroups.onDidChangeTabs((event) => {
      listener({
        closedSessionNames: event.closed
          .map((tab) => this.decodeDeckTab(tab)?.sessionName)
          .filter((sessionName): sessionName is string => sessionName !== undefined),
      });
    });
  }

  reopenSnapshot(isUnwired: (sessionName: string) => boolean): ReopenPlanSnapshot {
    return {
      groups: vscode.window.tabGroups.all.map((group, groupIndex) => ({
        viewColumn: group.viewColumn,
        isActive: group.isActive,
        activeTabId: group.activeTab ? this.tabId(groupIndex, group.tabs.indexOf(group.activeTab)) : undefined,
        tabs: group.tabs.map((tab, index) => {
          const decoded = this.decodeDeckTab(tab);
          const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
          return {
            id: this.tabId(groupIndex, index),
            index,
            isPinned: tab.isPinned,
            isDeckTerminal: decoded !== undefined,
            isUnwired: decoded ? isUnwired(decoded.sessionName) : false,
            canReveal: input?.uri !== undefined,
            uri: decoded?.uri ?? input?.uri,
            viewType: input?.viewType,
          };
        }),
      })),
    };
  }

  tabsById(): Map<string, vscode.Tab> {
    const tabs = new Map<string, vscode.Tab>();
    vscode.window.tabGroups.all.forEach((group, groupIndex) => {
      group.tabs.forEach((tab, index) => tabs.set(this.tabId(groupIndex, index), tab));
    });
    return tabs;
  }

  private deckTabs(): DisconnectedDeckTab[] {
    const tabs: DisconnectedDeckTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const decoded = this.decodeDeckTab(tab);
        if (!decoded) continue;
        tabs.push({
          sessionName: decoded.sessionName,
          uri: decoded.uri,
          isActive: tab.isActive,
        });
      }
    }
    return tabs;
  }

  private decodeDeckTab(tab: vscode.Tab): { sessionName: string; uri: vscode.Uri } | undefined {
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
    if (input?.viewType !== terminalEditorViewType || input.uri?.scheme !== terminalUriScheme) return undefined;
    try {
      return {
        sessionName: this.codec.decode(input.uri).sessionName,
        uri: input.uri,
      };
    } catch {
      return undefined;
    }
  }

  private tabId(groupIndex: number, tabIndex: number): string {
    return `${groupIndex}:${tabIndex}`;
  }
}
