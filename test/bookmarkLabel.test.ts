import { describe, expect, it } from 'vitest';
import { deriveBookmarkLabel } from '../src/bookmark/bookmarkLabel';

describe('deriveBookmarkLabel', () => {
  it('uses the final two path segments for a deep URL', () => {
    expect(deriveBookmarkLabel('https://github.com/microsoft/vscode/pull/1234')).toBe('pull/1234');
  });

  it('uses the host when a URL has no path', () => {
    expect(deriveBookmarkLabel('https://example.com')).toBe('example.com');
    expect(deriveBookmarkLabel('http://localhost:5173/')).toBe('localhost:5173');
  });

  it('ignores trailing slashes, query strings, and fragments', () => {
    expect(deriveBookmarkLabel('https://linear.app/deck/issue/DECK-186/?view=full#activity'))
      .toBe('issue/DECK-186');
    expect(deriveBookmarkLabel('https://example.com/?next=/fake/path#heading'))
      .toBe('example.com');
  });

  it('distinguishes two URLs on the same host', () => {
    const first = deriveBookmarkLabel('https://github.com/org/repo/pull/185');
    const second = deriveBookmarkLabel('https://github.com/org/repo/pull/186');

    expect(first).toBe('pull/185');
    expect(second).toBe('pull/186');
    expect(first).not.toBe(second);
  });
});
