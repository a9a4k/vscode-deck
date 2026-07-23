import type { TmuxSession } from './tmuxCli';
import { terminalSessionPrefix } from './tmuxSafe';
import type { CachedTerminalSession } from './terminalSession';
import { agentNameFromWindowName, resolveTerminalLabel } from './terminalLabelResolver';

export interface TerminalModelWorktreeDiff {
  worktreePrefix: string;
  added: readonly CachedTerminalSession[];
  removed: readonly CachedTerminalSession[];
  relabeled: readonly CachedTerminalSession[];
}

export class TerminalModel {
  private sessions = new Map<string, CachedTerminalSession>();

  apply(observed: readonly TmuxSession[]): TerminalModelWorktreeDiff[] {
    const next = observedTerminals(observed);
    const diffs = new Map<string, MutableWorktreeDiff>();

    for (const [sessionName, terminal] of next) {
      const previous = this.sessions.get(sessionName);
      if (previous === undefined) {
        diffFor(diffs, sessionName).added.push(terminal);
      } else if (!sameTerminal(previous, terminal)) {
        diffFor(diffs, sessionName).relabeled.push(terminal);
      }
    }
    for (const [sessionName, terminal] of this.sessions) {
      if (!next.has(sessionName)) diffFor(diffs, sessionName).removed.push(terminal);
    }

    this.sessions = next;
    return [...diffs.values()]
      .map(sortDiff)
      .sort((left, right) => left.worktreePrefix.localeCompare(right.worktreePrefix));
  }

  get(worktreePath: string): readonly CachedTerminalSession[] {
    const prefix = terminalSessionPrefix(worktreePath);
    return [...this.sessions.values()]
      .filter((session) => session.sessionName.startsWith(prefix))
      .sort(compareTerminals);
  }

  find(sessionName: string): CachedTerminalSession | undefined {
    return this.sessions.get(sessionName);
  }
}

interface MutableWorktreeDiff {
  worktreePrefix: string;
  added: CachedTerminalSession[];
  removed: CachedTerminalSession[];
  relabeled: CachedTerminalSession[];
}

function observedTerminals(observed: readonly TmuxSession[]): Map<string, CachedTerminalSession> {
  const terminals = new Map<string, CachedTerminalSession>();
  for (const session of observed) {
    const parsed = parseTerminalSessionName(session.sessionName);
    if (parsed === undefined) continue;
    terminals.set(session.sessionName, {
      sessionName: session.sessionName,
      n: parsed.n,
      windowName: session.windowName,
      paneTitle: session.paneTitle,
      agentName: session.agentName,
    });
  }
  return terminals;
}

function parseTerminalSessionName(sessionName: string): { worktreePrefix: string; n: number } | undefined {
  const match = /^(wt-.+__term-)([1-9]\d*)$/.exec(sessionName);
  if (match === null) return undefined;
  return { worktreePrefix: match[1], n: Number(match[2]) };
}

function diffFor(diffs: Map<string, MutableWorktreeDiff>, sessionName: string): MutableWorktreeDiff {
  const parsed = parseTerminalSessionName(sessionName);
  if (parsed === undefined) throw new Error(`invalid Terminal session name: ${sessionName}`);
  let diff = diffs.get(parsed.worktreePrefix);
  if (diff === undefined) {
    diff = {
      worktreePrefix: parsed.worktreePrefix,
      added: [],
      removed: [],
      relabeled: [],
    };
    diffs.set(parsed.worktreePrefix, diff);
  }
  return diff;
}

function sortDiff(diff: MutableWorktreeDiff): TerminalModelWorktreeDiff {
  diff.added.sort(compareTerminals);
  diff.removed.sort(compareTerminals);
  diff.relabeled.sort(compareTerminals);
  return diff;
}

function compareTerminals(left: CachedTerminalSession, right: CachedTerminalSession): number {
  return left.n - right.n || left.sessionName.localeCompare(right.sessionName);
}

function sameTerminal(left: CachedTerminalSession, right: CachedTerminalSession): boolean {
  return terminalDisplaySignature(left) === terminalDisplaySignature(right);
}

function terminalDisplaySignature(terminal: CachedTerminalSession): string {
  const agentName = terminal.agentName ?? agentNameFromWindowName(terminal.windowName);
  return JSON.stringify([
    resolveTerminalLabel(terminal.windowName, terminal.paneTitle, agentName),
    agentName,
  ]);
}
