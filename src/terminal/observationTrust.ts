import { TERMINAL_SNAPSHOT_ANCHOR_SESSION } from './terminalSnapshotRuntime';

export type ObservationTrust = 'down' | 'bare' | 'restored';

export function classifyObservation(sessions: readonly { sessionName: string }[]): ObservationTrust {
  if (sessions.length === 0) return 'down';
  if (sessions.every((session) => session.sessionName === TERMINAL_SNAPSHOT_ANCHOR_SESSION)) {
    return 'bare';
  }
  return 'restored';
}
