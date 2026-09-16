import { describe, expect, it } from 'vitest';
import { BracketedPasteModeScanner } from '../src/terminal/decModeScanner';

describe('BracketedPasteModeScanner', () => {
  it('reports bracketed paste as enabled until the pane disables it', () => {
    const scanner = new BracketedPasteModeScanner();

    expect(scanner.accept('\x1b[?2004h')).toBe(true);
    expect(scanner.accept('\x1b[?2004l')).toBe(false);
  });

  it.each([
    ['\x1b', '[?2004h'],
    ['\x1b[', '?2004h'],
    ['\x1b[?20', '04h'],
  ])('recognises an enable sequence split as %j + %j', (first, second) => {
    const scanner = new BracketedPasteModeScanner();

    expect(scanner.accept(first)).toBeUndefined();
    expect(scanner.accept(second)).toBe(true);
  });

  it('clears bracketed paste on RIS but not DECSTR', () => {
    const scanner = new BracketedPasteModeScanner();

    scanner.accept('\x1b[?2004h');
    expect(scanner.accept('\x1b[!p')).toBe(true);
    expect(scanner.accept('\x1bc')).toBe(false);
  });

  it('keeps the last mode choice when a pane toggles twice in one output chunk', () => {
    const scanner = new BracketedPasteModeScanner();

    expect(scanner.accept('\x1b[?2004h\x1b[?2004l')).toBe(false);
    expect(scanner.accept('\x1b[?2004l\x1b[?2004h')).toBe(true);
  });

  it('ignores plain text, unrelated escapes, and complete OSC/DCS strings', () => {
    const scanner = new BracketedPasteModeScanner();

    scanner.accept('\x1b[?2004h');

    expect(scanner.accept('plain\x1b[31mred\x1b]title\x07\x1bPpayload\x1b\\')).toBe(true);
  });

  it.each(['\x1b]unterminated title', '\x1bPunterminated data'])(
    'recovers from %j when the next escape starts a mode sequence',
    (unterminated) => {
      const scanner = new BracketedPasteModeScanner();

      scanner.accept(unterminated);

      expect(scanner.accept('\x1b[?2004h')).toBe(true);
    },
  );

  it('abandons a truncated escape sequence when ordinary output resumes', () => {
    const scanner = new BracketedPasteModeScanner();

    scanner.accept('\x1b[?20');

    expect(scanner.accept('oops04h')).toBeUndefined();
  });
});
