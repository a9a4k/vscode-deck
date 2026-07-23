import { agentNameFromWindowName, resolveTerminalLabel } from './terminalLabelResolver';
import type { TmuxSession } from './tmuxCli';
import type { AgentName } from '../agent/agentTypes';
import type { Disposable } from '../agent/agentStatusStore';

export interface TerminalPollScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface TerminalPollOptions {
  listSessions(): Promise<TmuxSession[]>;
  isFocused(): boolean;
  onDidChangeFocus(listener: (focused: boolean) => void): Disposable;
  scheduler?: TerminalPollScheduler;
  intervalMs?: number;
  onError?: (error: unknown) => void;
  resolveAgentName?: (sessionName: string) => Promise<AgentName | undefined>;
}

type LabelChangeListener = (changedSessions: readonly TmuxSession[]) => void;
type SessionSetChangeListener = () => void;

export class TerminalPoll implements Disposable {
  private readonly scheduler: TerminalPollScheduler;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly labelListeners = new Set<LabelChangeListener>();
  private readonly sessionSetListeners = new Set<SessionSetChangeListener>();
  private readonly labels = new Map<string, string>();
  private hasSessionSetBaseline = false;
  private focusSubscription: Disposable | undefined;
  private timer: unknown;
  private running = false;
  private disposed = false;

  constructor(private readonly options: TerminalPollOptions) {
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    this.intervalMs = options.intervalMs ?? 2000;
    this.onError = options.onError ?? (() => undefined);
  }

  onChange(listener: LabelChangeListener): Disposable {
    this.labelListeners.add(listener);
    return {
      dispose: () => {
        this.labelListeners.delete(listener);
      },
    };
  }

  onDidChangeSessionSet(listener: SessionSetChangeListener): Disposable {
    this.sessionSetListeners.add(listener);
    return {
      dispose: () => {
        this.sessionSetListeners.delete(listener);
      },
    };
  }

  start(): void {
    if (this.disposed) return;
    if (!this.focusSubscription) {
      this.focusSubscription = this.options.onDidChangeFocus((focused) => {
        if (focused) {
          this.start();
        } else {
          this.clearTimer();
        }
      });
    }
    if (!this.options.isFocused()) return;
    // start() is also the re-arm path: refreshTree() calls it on every tree
    // refresh, and a listener may call refreshTree() mid-tick. This guard
    // keeps both cheap while a tick is in flight or scheduled.
    if (this.running || this.timer !== undefined) return;
    this.runAndSchedule();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.focusSubscription?.dispose();
    this.focusSubscription = undefined;
    this.labelListeners.clear();
    this.sessionSetListeners.clear();
  }

  private runAndSchedule(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clearTimer();

    void this.runOnce()
      .catch(this.onError)
      .finally(() => {
        this.running = false;
        if (!this.disposed && this.options.isFocused()) {
          this.timer = this.scheduler.setTimeout(() => {
            this.timer = undefined;
            this.runAndSchedule();
          }, this.intervalMs);
        }
      });
  }

  private async runOnce(): Promise<void> {
    const sessions = await this.options.listSessions();
    const agentIdentities = await this.resolveAgentNames(sessions);
    const previousSessionNames = new Set(this.labels.keys());
    const nextLabels = new Map<string, string>();
    const changedSessions: TmuxSession[] = [];

    for (const [index, session] of sessions.entries()) {
      const { agentName, explicit } = agentIdentities[index];
      const label = resolveTerminalLabel(session.windowName, session.paneTitle, agentName);
      nextLabels.set(session.sessionName, label);
      const previousLabel = this.labels.get(session.sessionName);
      if (previousLabel !== undefined && previousLabel !== label) {
        changedSessions.push(explicit && agentName !== undefined ? { ...session, agentName } : session);
      }
    }

    const sessionSetChanged = this.hasSessionSetBaseline
      && !hasSameSessionNames(previousSessionNames, nextLabels);

    this.labels.clear();
    for (const [sessionName, label] of nextLabels) {
      this.labels.set(sessionName, label);
    }
    this.hasSessionSetBaseline = true;

    if (changedSessions.length > 0) {
      for (const listener of this.labelListeners) listener(changedSessions);
    }
    if (sessionSetChanged) {
      for (const listener of this.sessionSetListeners) listener();
    }
  }

  private async resolveAgentNames(
    sessions: readonly TmuxSession[],
  ): Promise<Array<{ agentName?: AgentName; explicit: boolean }>> {
    if (this.options.resolveAgentName === undefined) {
      return sessions.map((session) => {
        const agentName = session.agentName ?? agentNameFromWindowName(session.windowName);
        return { agentName, explicit: session.agentName !== undefined };
      });
    }

    return Promise.all(sessions.map(async (session) => {
      const explicitAgentName = session.agentName ?? await this.options.resolveAgentName!(session.sessionName);
      if (explicitAgentName !== undefined) {
        return { agentName: explicitAgentName, explicit: true };
      }
      return { agentName: agentNameFromWindowName(session.windowName), explicit: false };
    }));
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function hasSameSessionNames(
  previousSessionNames: ReadonlySet<string>,
  nextLabels: ReadonlyMap<string, string>,
): boolean {
  if (previousSessionNames.size !== nextLabels.size) return false;
  for (const sessionName of previousSessionNames) {
    if (!nextLabels.has(sessionName)) return false;
  }
  return true;
}
