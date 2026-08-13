import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    parse: (value: string) => {
      const url = new URL(value);
      return {
        scheme: url.protocol.slice(0, -1),
        get fsPath() {
          if (url.protocol !== 'file:') throw new Error('Only file URIs have filesystem paths');
          return fileURLToPath(url);
        },
      };
    },
  },
}));

import { fileDropPasteInput, filePathsFromUriList } from '../src/terminal/fileDrop';

describe('fileDropPasteInput', () => {
  it('wraps a single path in one bracketed paste', () => {
    expect(fileDropPasteInput(['/tmp/deck-drops/42-diagram.png']))
      .toBe('\x1b[200~/tmp/deck-drops/42-diagram.png\x1b[201~');
  });

  // One paste for the whole batch, space separated. Measured against a live
  // agent: a paste per path loses the first path's text when the pastes reach
  // the pane together, and unseparated paths merge into one unusable token.
  it('carries every path in one bracketed paste, space separated', () => {
    expect(fileDropPasteInput([
      '/tmp/deck-drops/42-before.png',
      '/tmp/deck-drops/42-middle.png',
      '/tmp/deck-drops/42-after.png',
    ])).toBe(
      '\x1b[200~/tmp/deck-drops/42-before.png'
      + ' /tmp/deck-drops/42-middle.png'
      + ' /tmp/deck-drops/42-after.png\x1b[201~',
    );
  });

  it('sends nothing for an empty drop', () => {
    expect(fileDropPasteInput([])).toBe('');
  });
});

describe('filePathsFromUriList', () => {
  it('returns every file path from a CRLF-separated uri-list in drag order', () => {
    expect(filePathsFromUriList(
      'file:///work/first.ts\r\nfile:///work/second.ts\r\nfile:///work/third.ts',
    )).toEqual([
      '/work/first.ts',
      '/work/second.ts',
      '/work/third.ts',
    ]);
  });

  it('ignores non-file URIs before reading their paths', () => {
    expect(filePathsFromUriList(
      'deck-decoration:/terminal/term-1\r\n'
      + 'file:///work/kept.ts\r\n'
      + 'https://example.com/file.ts\r\n'
      + 'untitled:Untitled-1',
    )).toEqual(['/work/kept.ts']);
  });

  it('ignores blank and comment lines in a uri-list', () => {
    expect(filePathsFromUriList(
      '\r\n# Explorer selection\r\nfile:///work/first.ts\n  \nfile:///work/second.ts\r\n',
    )).toEqual(['/work/first.ts', '/work/second.ts']);
  });

  it('decodes a percent-encoded file path', () => {
    expect(filePathsFromUriList('file:///work/My%20Documents/notes.ts'))
      .toEqual(['/work/My Documents/notes.ts']);
  });

  it('returns no paths for an empty uri-list', () => {
    expect(filePathsFromUriList('')).toEqual([]);
  });
});
