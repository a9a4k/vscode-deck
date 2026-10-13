import type { CodexPaneIdentity } from './codexPaneIdentity';
import type { CodexSharedServerState } from './codexSharedServerProbe';

const PROBE_DELAYS_MS = [1000, 4000, 10000] as const;

export interface CodexNoDaemonBannerScheduler {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CodexPaneObservation {
  sessionName: string;
  identity?: CodexPaneIdentity;
  processId?: number;
  observedByDeck?: boolean;
}

interface CodexNoDaemonBannerOptions {
  probe: { probe(): Promise<CodexSharedServerState> };
  settings: {
    isEnabled(): boolean;
    disable(): Promise<void>;
  };
  show(sessionName: string): void;
  hide(sessionName: string): void;
  scheduler?: CodexNoDaemonBannerScheduler;
}

interface BannerState {
  processId?: number;
  probeIndex: number;
  dismissed?: boolean;
  observedByDeck?: boolean;
  timer?: unknown;
  visible?: boolean;
}

export class CodexNoDaemonBanner {
  private readonly scheduler: CodexNoDaemonBannerScheduler;
  private readonly statesBySessionName = new Map<string, BannerState>();

  constructor(private readonly options: CodexNoDaemonBannerOptions) {
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
  }

  observe(observations: readonly CodexPaneObservation[]): void {
    if (!this.options.settings.isEnabled()) {
      this.stopAll();
      return;
    }
    // A different process is a new Codex run, so it starts over, × included.
    const affectedProcesses = new Map(
      observations
        .filter(({ identity }) => identity !== undefined && !identity.hasNoDaemon)
        .map(({ sessionName, processId }) => [sessionName, processId]),
    );
    for (const [sessionName, state] of this.statesBySessionName) {
      if (affectedProcesses.has(sessionName)
        && affectedProcesses.get(sessionName) === state.processId) continue;
      this.stopTracking(sessionName, state);
    }

    for (const observation of observations) {
      if (!observation.identity || observation.identity.hasNoDaemon) continue;
      const existing = this.statesBySessionName.get(observation.sessionName);
      if (observation.observedByDeck) {
        const state = existing ?? { processId: observation.processId, probeIndex: 0 };
        this.statesBySessionName.set(observation.sessionName, state);
        state.observedByDeck = true;
        this.hideAndCancel(observation.sessionName, state);
        continue;
      }
      if (existing) continue;
      const state = { processId: observation.processId, probeIndex: 0 };
      this.statesBySessionName.set(observation.sessionName, state);
      this.scheduleProbe(observation.sessionName, state);
    }
  }

  dismiss(sessionName: string): void {
    const state = this.statesBySessionName.get(sessionName);
    if (!state) return;
    state.dismissed = true;
    this.hideAndCancel(sessionName, state);
  }

  private hideAndCancel(sessionName: string, state: BannerState): void {
    if (state.timer !== undefined) {
      this.scheduler.clearTimeout(state.timer);
      state.timer = undefined;
    }
    if (state.visible) {
      state.visible = false;
      this.options.hide(sessionName);
    }
  }

  async disable(): Promise<void> {
    await this.options.settings.disable();
    this.stopAll();
  }

  dispose(): void {
    this.stopAll();
  }

  private scheduleProbe(sessionName: string, state: BannerState): void {
    const delay = PROBE_DELAYS_MS[state.probeIndex];
    if (delay === undefined) return;
    state.timer = this.scheduler.setTimeout(() => {
      state.timer = undefined;
      void this.probeSharedServer(sessionName, state);
    }, delay);
  }

  private async probeSharedServer(sessionName: string, state: BannerState): Promise<void> {
    const result = await this.options.probe.probe()
      .catch((): CodexSharedServerState => 'unknown');
    if (
      this.statesBySessionName.get(sessionName) !== state
      || state.dismissed
      || state.observedByDeck
    ) return;
    if (result === 'live') {
      state.visible = true;
      this.options.show(sessionName);
      return;
    }
    state.probeIndex += 1;
    this.scheduleProbe(sessionName, state);
  }

  private stopAll(): void {
    for (const [sessionName, state] of [...this.statesBySessionName]) {
      this.stopTracking(sessionName, state);
    }
  }

  private stopTracking(sessionName: string, state: BannerState): void {
    if (state.timer !== undefined) this.scheduler.clearTimeout(state.timer);
    if (state.visible) this.options.hide(sessionName);
    this.statesBySessionName.delete(sessionName);
  }
}
