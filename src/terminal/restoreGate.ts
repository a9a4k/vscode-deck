import { TERMINAL_SNAPSHOT_ANCHOR_SESSION } from './terminalSnapshotRuntime';
import { classifyObservation } from './observationTrust';

export type DeckSocketState =
  | { kind: 'down' }
  | { kind: 'bare' }
  | { kind: 'restoring'; done: Promise<void> }
  | RestoredDeckSocketState;

export interface RestoredDeckSocketState {
  kind: 'restored';
  sessions: ReadonlySet<string>;
}

export interface RestoreCoordinatorDeps {
  listSessions(): Promise<ReadonlyArray<{ sessionName: string }>>;
  restore(): Promise<unknown>;
  restoreLock?: {
    acquireBlocking(): Promise<boolean>;
    release(): Promise<void>;
  };
}

export interface RestoreCoordinator {
  classify(): Promise<DeckSocketState>;
  ensureRestored(): Promise<DeckSocketState>;
}

export function createRestoreCoordinator(deps: RestoreCoordinatorDeps): RestoreCoordinator {
  let inFlight: Promise<void> | undefined;

  const inspect = async (): Promise<DeckSocketState> => {
    const sessions = await deps.listSessions();
    const trust = classifyObservation(sessions);
    if (trust !== 'restored') return { kind: trust };

    const realSessions = new Set(
      sessions
        .map((session) => session.sessionName)
        .filter((sessionName) => sessionName !== TERMINAL_SNAPSHOT_ANCHOR_SESSION),
    );
    return { kind: 'restored', sessions: realSessions };
  };

  const classify = async (): Promise<DeckSocketState> => {
    if (inFlight) return { kind: 'restoring', done: inFlight };
    return inspect();
  };

  const guardedRestore = async (): Promise<void> => {
    const locked = (await deps.restoreLock?.acquireBlocking()) ?? false;
    try {
      if ((await inspect()).kind === 'restored') return;
      await deps.restore();
    } finally {
      if (locked) await deps.restoreLock?.release();
    }
  };

  const ensureRestored = async (): Promise<DeckSocketState> => {
    const state = await classify();
    switch (state.kind) {
      case 'restored':
        return state;
      case 'restoring':
        await state.done;
        return classify();
      case 'down':
      case 'bare':
        if (!inFlight) {
          inFlight = guardedRestore()
            .then(() => undefined)
            .finally(() => {
              inFlight = undefined;
            });
        }
        await inFlight;
        return classify();
    }
  };

  return { classify, ensureRestored };
}
