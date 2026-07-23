import type { TmuxSession } from './tmuxCli';
import { terminalSessionPrefix } from './tmuxSafe';
import { agentNameFromWindowName, resolveTerminalLabel } from './terminalLabelResolver';

export interface TerminalModelSession extends TmuxSession {
  n: number;
}

export interface TerminalModelWorktreeDiff {
  sessionPrefix: string;
  added: readonly TerminalModelSession[];
  removed: readonly TerminalModelSession[];
  relabeled: readonly TerminalModelSession[];
}

export class TerminalModel {
  private sessions = new Map<string, TerminalModelSession>();

  apply(observed: readonly TmuxSession[]): TerminalModelWorktreeDiff[] {
    const next = observedTerminals(observed);
    const diffs = new Map<string, MutableWorktreeDiff>();

    for (const [sessionName, terminal] of next) {
      const previous = this.sessions.get(sessionName);
      if (previous === undefined) {
        diffFor(diffs, sessionName).added.push(terminal);
      } else if (!sameTerminalDisplay(previous, terminal)) {
        diffFor(diffs, sessionName).relabeled.push(terminal);
      }
    }
    for (const [sessionName, terminal] of this.sessions) {
      if (!next.has(sessionName)) diffFor(diffs, sessionName).removed.push(terminal);
    }

    this.sessions = next;
    return [...diffs.values()]
      .map(sortDiff)
      .sort((left, right) => left.sessionPrefix.localeCompare(right.sessionPrefix));
  }

  get(worktreePath: string): readonly TerminalModelSession[] {
    const prefix = terminalSessionPrefix(worktreePath);
    return [...this.sessions.values()]
      .filter((session) => session.sessionName.startsWith(prefix))
      .sort(compareTerminals);
  }

  find(sessionName: string): TerminalModelSession | undefined {
    return this.sessions.get(sessionName);
  }
}

interface MutableWorktreeDiff {
  sessionPrefix: string;
  added: TerminalModelSession[];
  removed: TerminalModelSession[];
  relabeled: TerminalModelSession[];
}

function observedTerminals(observed: readonly TmuxSession[]): Map<string, TerminalModelSession> {
  const terminals = new Map<string, TerminalModelSession>();
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

function parseTerminalSessionName(sessionName: string): { sessionPrefix: string; n: number } | undefined {
  const match = /^(wt-.+__term-)([1-9]\d*)$/.exec(sessionName);
  if (match === null) return undefined;
  return { sessionPrefix: match[1], n: Number(match[2]) };
}

function diffFor(diffs: Map<string, MutableWorktreeDiff>, sessionName: string): MutableWorktreeDiff {
  const parsed = parseTerminalSessionName(sessionName);
  if (parsed === undefined) throw new Error(`invalid Terminal session name: ${sessionName}`);
  let diff = diffs.get(parsed.sessionPrefix);
  if (diff === undefined) {
    diff = {
      sessionPrefix: parsed.sessionPrefix,
      added: [],
      removed: [],
      relabeled: [],
    };
    diffs.set(parsed.sessionPrefix, diff);
  }
  return diff;
}

function sortDiff(diff: MutableWorktreeDiff): TerminalModelWorktreeDiff {
  diff.added.sort(compareTerminals);
  diff.removed.sort(compareTerminals);
  diff.relabeled.sort(compareTerminals);
  return diff;
}

function compareTerminals(left: TerminalModelSession, right: TerminalModelSession): number {
  return left.n - right.n || left.sessionName.localeCompare(right.sessionName);
}

function sameTerminalDisplay(left: TerminalModelSession, right: TerminalModelSession): boolean {
  const leftAgent = left.agentName ?? agentNameFromWindowName(left.windowName);
  const rightAgent = right.agentName ?? agentNameFromWindowName(right.windowName);
  return (
    leftAgent === rightAgent
    && resolveTerminalLabel(left.windowName, left.paneTitle, leftAgent)
      === resolveTerminalLabel(right.windowName, right.paneTitle, rightAgent)
  );
}
