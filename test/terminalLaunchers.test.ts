import { describe, expect, it } from 'vitest';
import { parseTerminalLaunchers } from '../src/launchers/terminalLaunchers';

describe('parseTerminalLaunchers', () => {
  it('keeps valid labeled launchers and skips invalid entries', () => {
    expect(parseTerminalLaunchers([
      { label: 'Dev', command: 'npm run dev' },
      { label: 'No command' },
      { label: 'Empty', command: '' },
      'npm test',
      null,
    ])).toEqual([
      { label: 'Dev', command: 'npm run dev' },
    ]);
  });

  it('uses the command as the label when a launcher has no label', () => {
    expect(parseTerminalLaunchers([{ command: 'npm run dev' }])).toEqual([
      { label: 'npm run dev', command: 'npm run dev' },
    ]);
  });
});
