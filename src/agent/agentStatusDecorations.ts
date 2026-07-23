import type { AgentStatus } from './agentStatusStore';
import {
  agentStatusDecorationCollapseInvalidationUris,
  agentStatusDecorationInvalidationUris,
} from './agentStatusDecorationInvalidations';
import {
  agentStatusDecorationScheme,
  type AgentStatusDecorationNodeKind,
  type AgentStatusDecorationResourceUri,
  type AgentStatusDecorationUri,
} from './agentStatusDecorationUris';

export {
  agentStatusDecorationResourceUri,
  agentStatusDecorationScheme,
  agentStatusDecorationUri,
  type AgentStatusDecorationNodeKind,
  type AgentStatusDecorationResourceUri,
  type AgentStatusDecorationUri,
} from './agentStatusDecorationUris';

export interface AgentStatusDecoration {
  badge: '•';
  colorId: 'list.warningForeground' | 'textLink.foreground' | 'errorForeground';
  tooltip: string;
}

export interface AgentStatusDecorationTerminal {
  repositoryPath: string;
  worktreePath: string;
  sessionName: string;
}

type AttentionStatus = AgentStatus & (
  | { status: 'needsInput' }
  | { status: 'failed' }
  | { status: 'completed' }
);

export function parseAgentStatusDecorationUri(
  uri: AgentStatusDecorationUri,
): { kind: AgentStatusDecorationNodeKind; id: string } | undefined {
  if (uri.scheme !== agentStatusDecorationScheme) return undefined;
  const match = uri.path.match(/^\/(repository|worktree|terminal)\/(.+)$/);
  if (!match) return undefined;
  return {
    kind: match[1] as AgentStatusDecorationNodeKind,
    id: decodeURIComponent(match[2]),
  };
}

export function provideAgentStatusDecoration(
  uri: AgentStatusDecorationUri,
  status: AgentStatus | undefined,
): AgentStatusDecoration | undefined {
  if (uri.scheme !== agentStatusDecorationScheme) return undefined;
  if (status?.status === 'needsInput') {
    return {
      badge: '•',
      colorId: 'list.warningForeground',
      tooltip: statusTooltip('Input needed', status.message),
    };
  }
  if (status?.status === 'completed' && status.unread !== false) {
    return {
      badge: '•',
      colorId: 'textLink.foreground',
      tooltip: statusTooltip('Completed', status.message),
    };
  }
  if (status?.status === 'failed') {
    return {
      badge: '•',
      colorId: 'errorForeground',
      tooltip: statusTooltip('Failed', status.message),
    };
  }
  return undefined;
}

function statusTooltip(label: string, message: string | undefined): string {
  return message ? `${label}: ${message}` : label;
}

export class AgentStatusDecorationRollups {
  private terminals: AgentStatusDecorationTerminal[] = [];
  private readonly terminalsBySession = new Map<string, AgentStatusDecorationTerminal>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly collapsedRepositories = new Set<string>();
  private readonly collapsedWorktrees = new Set<string>();

  setTerminals(terminals: readonly AgentStatusDecorationTerminal[]): AgentStatusDecorationResourceUri[] {
    const nextTerminalsBySession = new Map(
      terminals.map((terminal) => [terminal.sessionName, terminal]),
    );
    const changedSessionNames = new Set([
      ...this.terminalsBySession.keys(),
      ...nextTerminalsBySession.keys(),
    ].filter((sessionName) =>
      !sameTerminalLocation(
        this.terminalsBySession.get(sessionName),
        nextTerminalsBySession.get(sessionName),
      )));
    if (changedSessionNames.size === 0) return [];

    const invalidations = this.invalidationUrisForSessions(changedSessionNames);
    this.terminals = [...terminals];
    this.terminalsBySession.clear();
    for (const [sessionName, terminal] of nextTerminalsBySession) {
      this.terminalsBySession.set(sessionName, terminal);
    }
    invalidations.push(...this.invalidationUrisForSessions(changedSessionNames));
    return uniqueResourceUris(invalidations);
  }

  setStatuses(statuses: Iterable<readonly [string, AgentStatus]>): void {
    this.statuses.clear();
    for (const [sessionName, status] of statuses) {
      this.statuses.set(sessionName, status);
    }
  }

  setStatus(sessionName: string, status: AgentStatus | undefined): void {
    if (status === undefined) {
      this.statuses.delete(sessionName);
      return;
    }
    this.statuses.set(sessionName, status);
  }

  setCollapsed(kind: Exclude<AgentStatusDecorationNodeKind, 'terminal'>, id: string, collapsed: boolean): void {
    const collapsedSet = kind === 'repository' ? this.collapsedRepositories : this.collapsedWorktrees;
    if (collapsed) {
      collapsedSet.add(id);
    } else {
      collapsedSet.delete(id);
    }
  }

  invalidationUrisForSessions(sessionNames: Iterable<string>): AgentStatusDecorationResourceUri[] {
    return agentStatusDecorationInvalidationUris(sessionNames, this.terminals);
  }

  invalidationUrisForCollapsedNode(
    kind: Exclude<AgentStatusDecorationNodeKind, 'terminal'>,
    id: string,
  ): AgentStatusDecorationResourceUri[] {
    return agentStatusDecorationCollapseInvalidationUris(
      kind,
      id,
      this.terminals.filter((terminal) => attentionStatus(this.statuses.get(terminal.sessionName)) !== undefined),
    );
  }

  getDecorationStatus(kind: AgentStatusDecorationNodeKind, id: string): AgentStatus | undefined {
    let result: AttentionStatus | undefined;
    const target = nodeKey(kind, id);
    for (const terminal of this.terminals) {
      if (this.decorationTarget(terminal) !== target) continue;
      result = mostUrgent(result, attentionStatus(this.statuses.get(terminal.sessionName)));
    }
    return result;
  }

  private decorationTarget(terminal: AgentStatusDecorationTerminal): string {
    if (this.collapsedRepositories.has(terminal.repositoryPath)) {
      return nodeKey('repository', terminal.repositoryPath);
    }
    if (this.collapsedWorktrees.has(terminal.worktreePath)) {
      return nodeKey('worktree', terminal.worktreePath);
    }
    return nodeKey('terminal', terminal.sessionName);
  }
}

function sameTerminalLocation(
  left: AgentStatusDecorationTerminal | undefined,
  right: AgentStatusDecorationTerminal | undefined,
): boolean {
  return (
    left !== undefined
    && right !== undefined
    && left.repositoryPath === right.repositoryPath
    && left.worktreePath === right.worktreePath
  );
}

function uniqueResourceUris(
  uris: readonly AgentStatusDecorationResourceUri[],
): AgentStatusDecorationResourceUri[] {
  return [...new Map(uris.map((uri) => [
    `${uri.scheme}:${uri.authority}:${uri.path}:${uri.query}`,
    uri,
  ])).values()];
}

function nodeKey(kind: AgentStatusDecorationNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function attentionStatus(status: AgentStatus | undefined): AttentionStatus | undefined {
  if (status?.status === 'needsInput') return status as AttentionStatus;
  if (status?.status === 'failed') return status as AttentionStatus;
  if (status?.status === 'completed' && status.unread !== false) return status as AttentionStatus;
  return undefined;
}

function mostUrgent(
  current: AttentionStatus | undefined,
  candidate: AttentionStatus | undefined,
): AttentionStatus | undefined {
  if (candidate === undefined) return current;
  if (current === undefined || urgency(candidate) > urgency(current)) return candidate;
  return current;
}

function urgency(status: AttentionStatus): number {
  if (status.status === 'needsInput') return 3;
  if (status.status === 'failed') return 2;
  return 1;
}
