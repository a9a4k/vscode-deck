import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Worktree } from '../git/worktrees';
import { RepositoryCommonDirCache, resolveCommonDirSafe } from '../repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../repository/repositoryRegistryStore';
import { ActiveWorktreeStore } from '../switch/activeWorktreeStore';
import { WorktreeListCacheStore } from '../worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { terminalSessionPrefix } from '../terminal/tmuxSafe';
import { resolveTerminalTooltip } from '../terminal/terminalLabelResolver';
import { TerminalOrderStore } from '../terminal/terminalOrderStore';
import type { TmuxSession } from '../terminal/tmuxCli';
import { TerminalModel, type TerminalModelSession } from '../terminal/terminalModel';
import type { AgentStatus } from '../agent/agentStatusStore';
import {
  agentStatusDecorationResourceUri,
  AgentStatusDecorationRollups,
  type AgentStatusDecorationNodeKind,
  type AgentStatusDecorationResourceUri,
  type AgentStatusDecorationTerminal,
} from '../agent/agentStatusDecorations';
import { excludeBare } from './excludeBare';
import { excludePending } from './excludePending';
import { NodeRegistry } from './nodeRegistry';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
import { reconcileTerminalOrder } from './reconcileTerminalOrder';
import {
  describeRepositoryTreeItem,
  describeTmuxUnavailableTreeItem,
  describeTerminalTreeItem,
  describeWorktreeTreeItem,
} from './worktreeTreeItem';

export type RepositoryTreeNode = RepositoryNode | WorktreeNode | TerminalNode | TmuxUnavailableNode;

const resourcesDir = path.join(__dirname, '..', '..', 'resources');

// The terminal row's left icon carries agent identity, not status (status is
// the right-side decoration). The Claude marks ship as raster assets because
// VS Code currently renders custom tree SVGs black (microsoft/vscode#311339)
// and animated GIFs are the only sanctioned way to animate a custom tree icon.
// Do NOT swap the working GIF for a `loading~spin` codicon to chase reduce-motion:
// the codicon spin keyframe has no prefers-reduced-motion guard and ignores
// `workbench.reduceMotion` too, so it buys no a11y and loses the brand. No
// extension-side option makes an animated tree icon reduce-motion-aware. See ADR-0025 §6.
const terminalTreeIcon = {
  resourcesDir,
  factory: {
    uriFile: vscode.Uri.file,
    themeIcon: (id: string) => new vscode.ThemeIcon(id),
  },
};

interface AgentStatusLookup {
  get(sessionName: string): AgentStatus | undefined;
  entries(): IterableIterator<[string, AgentStatus]>;
  onDidChange(listener: () => void): { dispose(): void };
}

// Stable TreeItem.id values let VS Code persist expand/collapse + selection
// across reloads (it stores state per id under workbench.tree.<viewId>).

class RepositoryNode extends vscode.TreeItem {
  constructor(
    public readonly repositoryPath: string,
    isActiveRepository: boolean,
  ) {
    super('', vscode.TreeItemCollapsibleState.Expanded);
    this.id = `repository::${repositoryPath}`;
    this.contextValue = 'deck.repository';
    this.tooltip = repositoryPath;
    this.resourceUri = toDecorationUri('repository', repositoryPath);
    this.update(isActiveRepository);
  }

  update(isActiveRepository: boolean): void {
    const item = describeRepositoryTreeItem(this.repositoryPath, isActiveRepository);
    this.label = item.label;
    this.description = item.description;
  }
}

class WorktreeNode extends vscode.TreeItem {
  constructor(
    public readonly repositoryPath: string,
    public worktree: Worktree,
    isActiveWorktree: boolean,
    public mainWorktreePath: string | undefined,
  ) {
    super('', vscode.TreeItemCollapsibleState.Expanded);
    this.id = `worktree::${worktree.path}`;
    this.resourceUri = toDecorationUri('worktree', worktree.path);
    this.update(worktree, isActiveWorktree, mainWorktreePath);
  }

  update(
    worktree: Worktree,
    isActiveWorktree: boolean,
    mainWorktreePath: string | undefined,
  ): void {
    const item = describeWorktreeTreeItem(worktree, isActiveWorktree);
    this.worktree = worktree;
    this.mainWorktreePath = mainWorktreePath;
    this.label = item.label;
    this.contextValue = item.contextValue;
    this.description = item.description;
    this.tooltip = item.tooltip;
  }
}

class TerminalNode extends vscode.TreeItem {
  private renderSignature = '';

  constructor(
    public terminal: TmuxSession,
    public worktreeNode: WorktreeNode,
    isActiveWorktree: boolean,
    status?: AgentStatus,
  ) {
    super('', vscode.TreeItemCollapsibleState.None);
    this.id = `terminal::${terminal.sessionName}`;
    this.resourceUri = toDecorationUri('terminal', terminal.sessionName);
    this.command = {
      command: 'deck.openTerminal',
      title: 'Open Terminal',
      arguments: [this],
    };
    this.update(terminal, worktreeNode, isActiveWorktree, status);
  }

  update(
    terminal: TmuxSession,
    worktreeNode: WorktreeNode,
    isActiveWorktree: boolean,
    status?: AgentStatus,
  ): boolean {
    const item = describeTerminalTreeItem(
      terminal.windowName,
      isActiveWorktree,
      status,
      terminal.paneTitle,
      terminal.agentName,
      terminalTreeIcon,
    );
    const tooltip = resolveTerminalTooltip(this.worktreePath, terminal.sessionName);
    const nextSignature = JSON.stringify([item.label, item.contextValue, item.iconId, tooltip]);
    const changed = this.renderSignature !== '' && this.renderSignature !== nextSignature;

    this.terminal = terminal;
    this.worktreeNode = worktreeNode;
    this.label = item.label;
    this.contextValue = item.contextValue;
    this.description = item.description;
    this.tooltip = tooltip;
    this.iconPath = item.iconPath;
    this.renderSignature = nextSignature;
    return changed;
  }

  get repositoryPath(): string {
    return this.worktreeNode.repositoryPath;
  }

  get worktreePath(): string {
    return this.worktreeNode.worktree.path;
  }
}

class TmuxUnavailableNode extends vscode.TreeItem {
  constructor(public readonly worktreeNode: WorktreeNode) {
    const item = describeTmuxUnavailableTreeItem();
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.id = `tmux-unavailable::${worktreeNode.worktree.path}`;
    this.contextValue = item.contextValue;
    this.tooltip = item.tooltip;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
  }
}

export class RepositoryTreeProvider implements vscode.TreeDataProvider<RepositoryTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RepositoryTreeNode | undefined>();
  private readonly _onDidChangeDeckDecorations = new vscode.EventEmitter<AgentStatusDecorationResourceUri[]>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly onDidChangeDeckDecorations = this._onDidChangeDeckDecorations.event;
  readonly agentStatusDecorationRollups = new AgentStatusDecorationRollups();
  private activeRepositoryCommonDir: string | null = null;
  private activeWorktreePath: string | undefined = this.currentWorktreePath();
  private resolvingActiveRepository = false;
  private readonly repositoryCommonDirs = new Map<string, string | null>();
  private readonly renderedRepositories = new NodeRegistry<RepositoryNode>();
  private readonly renderedWorktrees = new NodeRegistry<WorktreeNode>();
  private readonly renderedTerminals = new Map<string, TerminalNode>();

  constructor(
    private readonly repositoryRegistry: Pick<RepositoryRegistryStore, 'list'>,
    private readonly activeWorktrees: ActiveWorktreeStore,
    private readonly worktreeOrders: WorktreeOrderStore,
    private readonly worktreeListCache: Pick<WorktreeListCacheStore, 'get' | 'set'> = {
      get: () => undefined,
      set: async () => undefined,
    },
    private readonly repositoryCommonDirCache: Pick<RepositoryCommonDirCache, 'get' | 'set'> = {
      get: () => undefined,
      set: async () => undefined,
    },
    private readonly terminalModel: TerminalModel = new TerminalModel(),
    private readonly tmuxAvailable = true,
    private readonly pendingWorktreeRemovals: ReadonlySet<string> = new Set(),
    private readonly agentStatuses?: AgentStatusLookup,
    private readonly terminalOrders?: Pick<TerminalOrderStore, 'get'>,
  ) {
    this.syncAgentStatuses();
    this.resolveActiveRepository(false);
    this.agentStatuses?.onDidChange(() => {
      this.syncAgentStatuses();
      this.refreshRenderedTerminals();
    });
  }

  refresh(): void {
    this.fireDeckDecorations(this.updateActiveWorktreeDecorationTarget());
    this.resolveActiveRepository(false);
    this._onDidChangeTreeData.fire(undefined);
    this.evictRemovedRepositories();
  }

  refreshWorktree(worktreePath: string): void {
    const node = this.renderedWorktrees.get(worktreePath);
    if (node !== undefined) this._onDidChangeTreeData.fire(node);
  }

  refreshRepository(repositoryPath: string): void {
    if (this.renderedRepositories.get(repositoryPath) === undefined) return;
    const node = this.toRepositoryNode(repositoryPath);
    this._onDidChangeTreeData.fire(node);
    this.evictRemovedWorktrees(repositoryPath);
  }

  refreshWorkspaceFolders(): void {
    const previousWorktreePath = this.activeWorktreePath;
    this.fireDeckDecorations(this.updateActiveWorktreeDecorationTarget());
    const currentWorktreePath = this.activeWorktreePath;
    for (const worktreePath of uniqueDefined([previousWorktreePath, currentWorktreePath])) {
      const existing = this.findRenderedWorktree(worktreePath);
      if (existing === undefined) continue;
      const node = this.toWorktreeNode(
        existing.repositoryPath,
        existing.worktree,
        existing.mainWorktreePath,
      );
      this._onDidChangeTreeData.fire(node);
    }
    this.resolveActiveRepository();
  }

  updateTerminalDecorations(terminals: readonly AgentStatusDecorationTerminal[]): void {
    this.fireDeckDecorations(this.agentStatusDecorationRollups.setTerminals(terminals));
  }

  refreshTerminalDisplays(sessions: readonly TmuxSession[]): void {
    for (const session of sessions) {
      const node = this.renderedTerminals.get(session.sessionName);
      if (!node) continue;
      this.refreshTerminalDisplay(node, session);
    }
  }

  private refreshRenderedTerminals(): void {
    for (const node of this.renderedTerminals.values()) {
      this.refreshTerminalDisplay(node, node.terminal);
    }
  }

  private refreshTerminalDisplay(node: TerminalNode, terminal: TmuxSession): void {
    if (!node.update(
      terminal,
      node.worktreeNode,
      this.isCurrentWorktree(node.worktreePath),
      this.agentStatuses?.get(terminal.sessionName),
    )) return;

    this._onDidChangeTreeData.fire(node);
  }

  getTreeItem(element: RepositoryTreeNode): vscode.TreeItem {
    return element;
  }

  isActiveRepositoryDecorationTarget(repositoryPath: string): boolean {
    return this.isActiveRepository(repositoryPath);
  }

  isActiveWorktreeDecorationTarget(worktreePath: string): boolean {
    return this.isCurrentWorktree(worktreePath);
  }

  setCollapsed(element: RepositoryTreeNode, collapsed: boolean): AgentStatusDecorationResourceUri[] {
    if (element instanceof RepositoryNode) {
      const uris = this.agentStatusDecorationRollups.invalidationUrisForCollapsedNode(
        'repository',
        element.repositoryPath,
      );
      this.agentStatusDecorationRollups.setCollapsed('repository', element.repositoryPath, collapsed);
      return uris;
    }
    if (element instanceof WorktreeNode) {
      const uris = this.agentStatusDecorationRollups.invalidationUrisForCollapsedNode('worktree', element.worktree.path);
      this.agentStatusDecorationRollups.setCollapsed('worktree', element.worktree.path, collapsed);
      return uris;
    }
    return [];
  }

  getParent(element: RepositoryTreeNode): RepositoryTreeNode | undefined {
    if (element instanceof WorktreeNode) {
      return this.toRepositoryNode(element.repositoryPath);
    }
    if (element instanceof TerminalNode) {
      return element.worktreeNode;
    }
    if (element instanceof TmuxUnavailableNode) {
      return element.worktreeNode;
    }
    return undefined;
  }

  getChildren(element?: RepositoryTreeNode): vscode.ProviderResult<RepositoryTreeNode[]> {
    if (!element) {
      // Sync return: any `await` here would yield to the event loop and let
      // viewsWelcome ("No repositories yet") flash on every tree.refresh().
      const repositories = this.repositoryRegistry.list();
      return repositories.map((repositoryPath) => this.toRepositoryNode(repositoryPath));
    }
    if (element instanceof RepositoryNode) {
      return this.getWorktreeChildren(element);
    }
    if (element instanceof WorktreeNode) {
      if (!this.tmuxAvailable) return [new TmuxUnavailableNode(element)];
      return this.getTerminalChildren(element);
    }
    return [];
  }

  async findTerminal(
    sessionName: string,
    worktreePath: string,
  ): Promise<RepositoryTreeNode | undefined> {
    if (this.terminalModel.find(sessionName) === undefined) return undefined;
    return this.findTerminalNode(
      sessionName,
      (worktree) => path.resolve(worktree.worktree.path) === path.resolve(worktreePath),
    );
  }

  async findTerminalBySessionName(
    sessionName: string,
    liveSession?: TmuxSession,
  ): Promise<RepositoryTreeNode | undefined> {
    if (this.terminalModel.find(sessionName) !== undefined) {
      return this.findTerminalNode(sessionName);
    }
    if (liveSession === undefined) return undefined;
    const worktree = this.findWorktreeNodeForSession(sessionName);
    if (worktree === undefined) return undefined;
    return this.toTerminalNode(worktree, liveSession);
  }

  async describeSession(sessionName: string): Promise<{ repo: string; branch: string } | undefined> {
    const worktree = this.findWorktreeNodeForSession(sessionName);
    if (worktree === undefined) return undefined;
    return {
      repo: path.basename(worktree.repositoryPath),
      branch: worktree.worktree.branch ?? path.basename(worktree.worktree.path),
    };
  }

  private async findTerminalNode(
    sessionName: string,
    worktreeMatches: (worktree: WorktreeNode) => boolean = () => true,
  ): Promise<TerminalNode | undefined> {
    const worktree = this.findWorktreeNodeForSession(sessionName, worktreeMatches);
    if (worktree === undefined) return undefined;
    const terminals = this.getTerminalChildren(worktree);
    for (const terminal of terminals) {
      if (terminal instanceof TerminalNode && terminal.terminal.sessionName === sessionName) {
        return terminal;
      }
    }
    return undefined;
  }

  private findWorktreeNodeForSession(
    sessionName: string,
    worktreeMatches: (worktree: WorktreeNode) => boolean = () => true,
  ): WorktreeNode | undefined {
    for (const repositoryPath of this.repositoryRegistry.list()) {
      const commonDir =
        this.repositoryCommonDirCache.get(repositoryPath)
        ?? this.repositoryCommonDirs.get(repositoryPath)
        ?? undefined;
      if (commonDir === undefined || commonDir === null) continue;
      const cached = this.worktreeListCache.get(commonDir);
      if (cached === undefined) continue;
      const worktrees = this.toWorktreeNodes(repositoryPath, cached, commonDir);
      const match = worktrees.find((worktree) =>
        sessionName.startsWith(terminalSessionPrefix(worktree.worktree.path))
        && worktreeMatches(worktree));
      if (match !== undefined) return match;
    }
    return undefined;
  }

  private currentWorktreePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private isCurrentWorktree(worktreePath: string): boolean {
    const activeWorktreePath = this.currentWorktreePath();
    return activeWorktreePath !== undefined && path.resolve(worktreePath) === path.resolve(activeWorktreePath);
  }

  private isActiveRepository(repositoryPath: string): boolean {
    const repositoryCommonDir =
      this.repositoryCommonDirCache.get(repositoryPath)
      ?? this.repositoryCommonDirs.get(repositoryPath);
    return (
      repositoryCommonDir !== undefined &&
      repositoryCommonDir !== null &&
      repositoryCommonDir === this.activeRepositoryCommonDir
    );
  }

  private toRepositoryNode(repositoryPath: string): RepositoryNode {
    const isActiveRepository = this.isActiveRepository(repositoryPath);
    const item = describeRepositoryTreeItem(repositoryPath, isActiveRepository);
    return this.renderedRepositories.upsert(
      repositoryPath,
      JSON.stringify([item.label, item.description]),
      () => new RepositoryNode(repositoryPath, isActiveRepository),
      (node) => node.update(isActiveRepository),
    ).node;
  }

  private getWorktreeChildren(element: RepositoryNode): RepositoryTreeNode[] {
    const commonDir =
      this.repositoryCommonDirCache.get(element.repositoryPath) ??
      this.repositoryCommonDirs.get(element.repositoryPath) ??
      undefined;
    if (commonDir === undefined) return [];
    const cached = this.worktreeListCache.get(commonDir);
    if (cached === undefined) return [];
    return this.toWorktreeNodes(
      element.repositoryPath,
      this.visibleWorktrees(cached),
      commonDir,
    );
  }

  private resolveActiveRepository(fire = true): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.setActiveRepositoryCommonDir(null, fire);
      return;
    }

    const cached = this.repositoryCommonDirCache.get(folder.uri.fsPath);
    if (cached !== undefined) {
      this.setActiveRepositoryCommonDir(cached, fire);
      return;
    }
    if (this.resolvingActiveRepository) return;

    this.resolvingActiveRepository = true;
    void resolveCommonDirSafe(this.repositoryCommonDirCache, folder.uri.fsPath)
      .then((commonDir) => {
        this.setActiveRepositoryCommonDir(commonDir);
      })
      .finally(() => {
        this.resolvingActiveRepository = false;
      });
  }

  private setActiveRepositoryCommonDir(commonDir: string | null, fire = true): void {
    if (this.activeRepositoryCommonDir === commonDir) return;
    const previous = this.activeRepositoryCommonDir;
    this.activeRepositoryCommonDir = commonDir;
    this.fireDeckDecorations(this.activeRepositoryDecorationInvalidationUris());
    if (!fire) return;

    for (const affectedCommonDir of uniqueDefined([previous, commonDir])) {
      for (const repositoryPath of this.repositoryRegistry.list()) {
        const repositoryCommonDir =
          this.repositoryCommonDirCache.get(repositoryPath)
          ?? this.repositoryCommonDirs.get(repositoryPath);
        if (repositoryCommonDir !== affectedCommonDir) continue;
        const node = this.renderedRepositories.get(repositoryPath);
        if (node === undefined) continue;
        this.toRepositoryNode(repositoryPath);
        this._onDidChangeTreeData.fire(node);
      }
    }
  }

  private updateActiveWorktreeDecorationTarget(): AgentStatusDecorationResourceUri[] {
    const current = this.currentWorktreePath();
    const previous = this.activeWorktreePath;
    if (current === previous) return [];
    this.activeWorktreePath = current;
    const uris: AgentStatusDecorationResourceUri[] = [];
    if (previous !== undefined) uris.push(agentStatusDecorationResourceUri('worktree', previous));
    if (current !== undefined) uris.push(agentStatusDecorationResourceUri('worktree', current));
    return uris;
  }

  private activeRepositoryDecorationInvalidationUris(): AgentStatusDecorationResourceUri[] {
    return this.repositoryRegistry.list()
      .map((repositoryPath) => agentStatusDecorationResourceUri('repository', repositoryPath));
  }

  private fireDeckDecorations(uris: readonly AgentStatusDecorationResourceUri[]): void {
    if (uris.length === 0) return;
    this._onDidChangeDeckDecorations.fire([...uris]);
  }

  private findRenderedWorktree(worktreePath: string): WorktreeNode | undefined {
    const exact = this.renderedWorktrees.get(worktreePath);
    if (exact !== undefined) return exact;
    return [...this.renderedWorktrees.values()].find(
      (node) => path.resolve(node.worktree.path) === path.resolve(worktreePath),
    );
  }

  private evictRemovedRepositories(): void {
    const registered = new Set(this.repositoryRegistry.list());
    for (const repositoryPath of [...this.renderedRepositories.keys()]) {
      if (registered.has(repositoryPath)) continue;
      this.renderedRepositories.evict(repositoryPath, () => undefined);
      for (const worktree of [...this.renderedWorktrees.values()]) {
        if (worktree.repositoryPath !== repositoryPath) continue;
        this.evictWorktree(worktree.worktree.path);
      }
    }
  }

  private evictRemovedWorktrees(repositoryPath: string): void {
    const commonDir =
      this.repositoryCommonDirCache.get(repositoryPath)
      ?? this.repositoryCommonDirs.get(repositoryPath)
      ?? undefined;
    if (commonDir === undefined) return;
    const cached = this.worktreeListCache.get(commonDir);
    if (cached === undefined) return;
    const live = new Set(this.visibleWorktrees(cached).map((worktree) => worktree.path));
    for (const worktree of [...this.renderedWorktrees.values()]) {
      if (worktree.repositoryPath !== repositoryPath || live.has(worktree.worktree.path)) continue;
      this.evictWorktree(worktree.worktree.path);
    }
  }

  private evictWorktree(worktreePath: string): void {
    this.renderedWorktrees.evict(worktreePath, () => undefined);
    for (const [sessionName, terminal] of this.renderedTerminals) {
      if (terminal.worktreePath === worktreePath) this.renderedTerminals.delete(sessionName);
    }
  }

  private getTerminalChildren(element: WorktreeNode): RepositoryTreeNode[] {
    const terminals = reconcileTerminalOrder(
      this.terminalOrders?.get(element.worktree.path),
      this.terminalModel.get(element.worktree.path),
    );
    return this.toTerminalNodes(element, terminals);
  }

  private toTerminalNodes(element: WorktreeNode, terminals: readonly TerminalModelSession[]): RepositoryTreeNode[] {
    const liveSessionNames = new Set(terminals.map((terminal) => terminal.sessionName));
    const nodes = terminals.map((terminal) => this.toTerminalNode(element, terminal));
    for (const [sessionName, node] of this.renderedTerminals) {
      if (node.worktreePath === element.worktree.path && !liveSessionNames.has(sessionName)) {
        this.renderedTerminals.delete(sessionName);
      }
    }
    return nodes;
  }

  private toTerminalNode(element: WorktreeNode, terminal: TmuxSession): TerminalNode {
    const status = this.agentStatuses?.get(terminal.sessionName);
    const existing = this.renderedTerminals.get(terminal.sessionName);
    if (existing !== undefined) {
      existing.update(terminal, element, this.isCurrentWorktree(element.worktree.path), status);
      return existing;
    }
    const node = new TerminalNode(
      terminal,
      element,
      this.isCurrentWorktree(element.worktree.path),
      status,
    );
    this.renderedTerminals.set(terminal.sessionName, node);
    return node;
  }

  private toWorktreeNode(
    repositoryPath: string,
    worktree: Worktree,
    mainWorktreePath: string | undefined,
  ): WorktreeNode {
    const isActiveWorktree = this.isCurrentWorktree(worktree.path);
    const item = describeWorktreeTreeItem(worktree, isActiveWorktree);
    return this.renderedWorktrees.upsert(
      worktree.path,
      JSON.stringify([item.label, item.description, item.tooltip, item.contextValue]),
      () => new WorktreeNode(repositoryPath, worktree, isActiveWorktree, mainWorktreePath),
      (node) => node.update(worktree, isActiveWorktree, mainWorktreePath),
    ).node;
  }

  private toWorktreeNodes(
    repositoryPath: string,
    gitWorktrees: readonly Worktree[],
    commonDir: string | undefined,
  ): WorktreeNode[] {
    const worktrees = this.visibleWorktrees(
      reconcileWorktreeOrder(
        commonDir === undefined ? undefined : this.worktreeOrders.get(commonDir),
        [...gitWorktrees],
      ),
    );
    const mainWorktreePath = gitWorktrees.find((worktree) => worktree.main)?.path;
    return worktrees.map((worktree) =>
      this.toWorktreeNode(
        repositoryPath,
        worktree,
        mainWorktreePath,
      ));
  }

  private visibleWorktrees(
    worktrees: readonly Worktree[],
    pendingAtListStart?: ReadonlySet<string>,
  ): Worktree[] {
    const currentlyVisible = excludePending(excludeBare(worktrees), this.pendingWorktreeRemovals);
    if (pendingAtListStart === undefined) return currentlyVisible;
    return excludePending(currentlyVisible, pendingAtListStart);
  }

  private syncAgentStatuses(): void {
    const statuses = [...(this.agentStatuses?.entries() ?? [])];
    this.agentStatusDecorationRollups.setStatuses(statuses);
  }
}

function toDecorationUri(
  kind: AgentStatusDecorationNodeKind,
  id: string,
): vscode.Uri {
  return vscode.Uri.from(agentStatusDecorationResourceUri(kind, id));
}

function uniqueDefined<T>(values: readonly (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];
}
