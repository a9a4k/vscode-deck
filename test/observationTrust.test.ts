import { describe, expect, it } from 'vitest';
import { classifyObservation } from '../src/terminal/observationTrust';
import { TERMINAL_SNAPSHOT_ANCHOR_SESSION } from '../src/terminal/terminalSnapshotRuntime';

describe('ObservationTrust', () => {
  it('classifies an empty DeckSocket observation as down', () => {
    expect(classifyObservation([])).toBe('down');
  });

  it('classifies an anchor-only DeckSocket observation as bare', () => {
    expect(classifyObservation([
      { sessionName: TERMINAL_SNAPSHOT_ANCHOR_SESSION, windowName: 'anchor' },
    ])).toBe('bare');
  });

  it('classifies any observation with a real session as restored', () => {
    const terminal = { sessionName: 'wt-_work_alpha__term-1', windowName: 'zsh' };

    expect(classifyObservation([terminal])).toBe('restored');
    expect(classifyObservation([
      { sessionName: TERMINAL_SNAPSHOT_ANCHOR_SESSION, windowName: 'anchor' },
      terminal,
    ])).toBe('restored');
  });
});
