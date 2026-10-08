import { agentNameFromWindowName, resolveTerminalLabel } from './terminalLabelResolver';
import type { TmuxSession } from './tmuxCli';
import type { AgentName } from '../agent/agentTypes';
import type { Disposable } from '../agent/agentStatusStore';
import { mayRunCodex, type CodexPaneIdentity } from './codexPaneIdentity';
import type { CodexPaneObservation } from './codexNoDaemonBanner';

export interface TerminalPollScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface TerminalPollOptions {
  listSessions(): Promise<TmuxSession[]>;
  reconcileObservation(sessions: readonly TmuxSession[]): Promise<void> | void;
  isFocused(): boolean;
  onDidChangeFocus(listener: (focused: boolean) => void): Disposable;
  scheduler?: TerminalPollScheduler;
  intervalMs?: number;
  onError?: (error: unknown) => void;
  resolveAgentName?: (sessionName: string) => Promise<AgentName | undefined>;
  readForegroundProcessIds?: (sessionNames: readonly string[]) => Promise<Map<string, number>>;
  resolveCodexPaneIdentity?: (
    paneCommand: string,
    foregroundProcessId: number,
  ) => Promise<CodexPaneIdentity | undefined>;
  observeCodexPanes?: (observations: readonly CodexPaneObservation[]) => void;
}

type LabelChangeListener = (changedSessions: readonly TmuxSession[]) => void;

export class TerminalPoll implements Disposable {
  private readonly scheduler: TerminalPollScheduler;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly labelListeners = new Set<LabelChangeListener>();
  private readonly labels = new Map<string, string>();
  private readonly codexIdentities = new Map<
    string,
    { paneCommand: string; processId: number; identity?: CodexPaneIdentity }
  >();
  private focusSubscription: Disposable | undefined;
  private timer: unknown;
  private running = false;
  private wakePending = false;
  private disposed = false;

  constructor(private readonly options: TerminalPollOptions) {
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    this.intervalMs = options.intervalMs ?? 2000;
    this.onError = options.onError ?? (() => undefined);
  }

  onDidChangeLabels(listener: LabelChangeListener): Disposable {
    this.labelListeners.add(listener);
    return {
      dispose: () => {
        this.labelListeners.delete(listener);
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
    if (this.running || this.timer !== undefined) return;
    this.runAndSchedule();
  }

  wake(): void {
    if (this.disposed || !this.options.isFocused()) return;
    if (this.running) {
      this.wakePending = true;
      return;
    }
    this.clearTimer();
    this.runAndSchedule();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.focusSubscription?.dispose();
    this.focusSubscription = undefined;
    this.labelListeners.clear();
    this.codexIdentities.clear();
  }

  private runAndSchedule(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clearTimer();

    void this.runOnce()
      .catch(this.onError)
      .finally(() => {
        this.running = false;
        if (this.disposed || !this.options.isFocused()) {
          this.wakePending = false;
        } else if (this.wakePending) {
          this.wakePending = false;
          this.runAndSchedule();
        } else {
          this.timer = this.scheduler.setTimeout(() => {
            this.timer = undefined;
            this.runAndSchedule();
          }, this.intervalMs);
        }
      });
  }

  private async runOnce(): Promise<void> {
    const sessions = await this.options.listSessions();
    const [agentIdentities, codexIdentities] = await Promise.all([
      this.resolveAgentNames(sessions),
      this.resolveCodexPaneIdentities(sessions),
    ]);
    const resolvedIdentities = agentIdentities.map((identity, index) => {
      if (identity.explicit) return identity;

      const codexIdentity = codexIdentities[index].identity;
      if (codexIdentity) return { agentName: codexIdentity.agentName, explicit: true };

      return identity;
    });
    const observedSessions = sessions.map((session, index) => {
      const identity = resolvedIdentities[index];
      return identity.explicit && identity.agentName !== undefined
        ? { ...session, agentName: identity.agentName }
        : session;
    });
    this.options.observeCodexPanes?.(sessions.map((session, index) => ({
      sessionName: session.sessionName,
      ...codexIdentities[index],
    })));
    await this.options.reconcileObservation(observedSessions);
    const nextLabels = new Map<string, string>();
    const changedSessions: TmuxSession[] = [];

    for (const [index, session] of observedSessions.entries()) {
      const { agentName } = resolvedIdentities[index];
      const label = resolveTerminalLabel(session.windowName, session.paneTitle, agentName);
      nextLabels.set(session.sessionName, label);
      const previousLabel = this.labels.get(session.sessionName);
      if (previousLabel !== undefined && previousLabel !== label) {
        changedSessions.push(session);
      }
    }

    this.labels.clear();
    for (const [sessionName, label] of nextLabels) {
      this.labels.set(sessionName, label);
    }
    if (changedSessions.length > 0) {
      for (const listener of this.labelListeners) listener(changedSessions);
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

  // Keyed on the foreground process: a Codex restarted in the same Terminal
  // keeps the same program name.
  private async resolveCodexPaneIdentities(
    sessions: readonly TmuxSession[],
  ): Promise<Array<{ identity?: CodexPaneIdentity; processId?: number }>> {
    const candidates = sessions
      .filter(({ paneCommand }) => mayRunCodex(paneCommand ?? ''))
      .map(({ sessionName }) => sessionName);
    const { readForegroundProcessIds, resolveCodexPaneIdentity } = this.options;
    const processIds = candidates.length > 0 && readForegroundProcessIds && resolveCodexPaneIdentity
      ? await readForegroundProcessIds(candidates)
      : new Map<string, number>();

    const resolved = await Promise.all(sessions.map(async ({ sessionName, paneCommand = '' }) => {
      const processId = processIds.get(sessionName);
      if (processId === undefined) return {};
      const cached = this.codexIdentities.get(sessionName);
      const identity = cached?.paneCommand === paneCommand && cached.processId === processId
        ? cached.identity
        : await resolveCodexPaneIdentity!(paneCommand, processId);
      return { identity, processId };
    }));

    this.codexIdentities.clear();
    resolved.forEach(({ identity, processId }, index) => {
      if (processId === undefined) return;
      const { sessionName, paneCommand = '' } = sessions[index];
      this.codexIdentities.set(sessionName, { paneCommand, processId, identity });
    });
    return resolved;
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
