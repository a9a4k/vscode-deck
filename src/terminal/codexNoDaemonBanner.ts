import type { CodexPaneIdentity } from './codexPaneIdentity';
import type { CodexSharedServerState } from './codexSharedServerProbe';

const RETRY_DELAYS_MS = [1000, 4000, 10000] as const;

export interface CodexNoDaemonBannerScheduler {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CodexPaneObservation {
  sessionName: string;
  identity?: CodexPaneIdentity;
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
  attempt: number;
  dismissed?: boolean;
  timer?: unknown;
  visible?: boolean;
}

export class CodexNoDaemonBanner {
  private readonly scheduler: CodexNoDaemonBannerScheduler;
  private readonly states = new Map<string, BannerState>();

  constructor(private readonly options: CodexNoDaemonBannerOptions) {
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
  }

  observe(observations: readonly CodexPaneObservation[]): void {
    const enabled = this.options.settings.isEnabled();
    if (!enabled) {
      for (const [sessionName, state] of [...this.states]) this.stop(sessionName, state);
      return;
    }
    const affectedSessions = new Set(
      observations
        .filter(({ identity }) => identity !== undefined && !identity.hasNoDaemon)
        .map(({ sessionName }) => sessionName),
    );
    for (const [sessionName, state] of this.states) {
      if (affectedSessions.has(sessionName)) continue;
      this.stop(sessionName, state);
    }

    for (const observation of observations) {
      if (!observation.identity || observation.identity.hasNoDaemon) continue;
      if (this.states.has(observation.sessionName)) continue;
      const state = { attempt: 0 };
      this.states.set(observation.sessionName, state);
      this.schedule(observation.sessionName, state);
    }
  }

  dismiss(sessionName: string): void {
    const state = this.states.get(sessionName);
    if (!state) return;
    state.dismissed = true;
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
    for (const [sessionName, state] of [...this.states]) this.stop(sessionName, state);
  }

  dispose(): void {
    for (const [sessionName, state] of [...this.states]) this.stop(sessionName, state);
  }

  private schedule(sessionName: string, state: BannerState): void {
    const delay = RETRY_DELAYS_MS[state.attempt];
    if (delay === undefined) return;
    state.timer = this.scheduler.setTimeout(() => {
      state.timer = undefined;
      void this.options.probe.probe().catch((): CodexSharedServerState => 'unknown').then((result) => {
        if (this.states.get(sessionName) !== state || state.dismissed) return;
        if (result === 'live') {
          state.visible = true;
          this.options.show(sessionName);
          return;
        }
        state.attempt += 1;
        this.schedule(sessionName, state);
      });
    }, delay);
  }

  private stop(sessionName: string, state: BannerState): void {
    if (state.timer !== undefined) this.scheduler.clearTimeout(state.timer);
    if (state.visible) this.options.hide(sessionName);
    this.states.delete(sessionName);
  }
}
