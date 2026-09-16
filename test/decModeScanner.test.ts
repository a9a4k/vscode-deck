import { describe, expect, it } from 'vitest';
import { DecModeScanner } from '../src/terminal/decModeScanner';

describe('DecModeScanner', () => {
  it('reports bracketed paste as enabled until the pane disables it', () => {
    const scanner = new DecModeScanner();

    expect(scanner.accept('\x1b[?2004h').get(2004)).toBe(true);
    expect(scanner.accept('\x1b[?2004l').get(2004)).toBe(false);
  });

  it.each([
    ['\x1b', '[?2004h'],
    ['\x1b[', '?2004h'],
    ['\x1b[?20', '04h'],
  ])('recognises an enable sequence split as %j + %j', (first, second) => {
    const scanner = new DecModeScanner();

    expect(scanner.accept(first).get(2004)).toBeUndefined();
    expect(scanner.accept(second).get(2004)).toBe(true);
  });

  it('clears bracketed paste on RIS but not DECSTR', () => {
    const scanner = new DecModeScanner();

    scanner.accept('\x1b[?2004h');
    expect(scanner.accept('\x1b[!p').get(2004)).toBe(true);
    expect(scanner.accept('\x1bc').get(2004)).toBe(false);
  });

  it('keeps the last mode choice when a pane toggles twice in one output chunk', () => {
    const scanner = new DecModeScanner();

    expect(scanner.accept('\x1b[?2004h\x1b[?2004l').get(2004)).toBe(false);
    expect(scanner.accept('\x1b[?2004l\x1b[?2004h').get(2004)).toBe(true);
  });

  it('ignores plain text, unrelated escapes, and complete OSC/DCS strings', () => {
    const scanner = new DecModeScanner();

    scanner.accept('\x1b[?2004h');

    expect(scanner.accept('plain\x1b[31mred\x1b]title\x07\x1bPpayload\x1b\\').get(2004)).toBe(true);
  });

  it.each(['\x1b]unterminated title', '\x1bPunterminated data'])(
    'recovers from %j when the next escape starts a mode sequence',
    (unterminated) => {
      const scanner = new DecModeScanner();

      scanner.accept(unterminated);

      expect(scanner.accept('\x1b[?2004h').get(2004)).toBe(true);
    },
  );

  it('abandons a truncated escape sequence when ordinary output resumes', () => {
    const scanner = new DecModeScanner();

    scanner.accept('\x1b[?20');

    expect(scanner.accept('oops04h').get(2004)).toBeUndefined();
  });
});
