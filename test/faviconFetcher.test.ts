import { describe, expect, it, vi } from 'vitest';
import { FaviconFetcher } from '../src/bookmark/faviconFetcher';

function response(
  body: string | Uint8Array,
  { ok = true, url = 'https://example.com/' }: { ok?: boolean; url?: string } = {},
) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok,
    url,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    text: async () => new TextDecoder().decode(bytes),
  };
}

function rejectWhenAborted(
  _url: string,
  { signal }: { signal: AbortSignal },
): Promise<never> {
  return new Promise((_resolve, reject) => {
    const rejectOnAbort = () => reject(signal.reason);
    if (signal.aborted) rejectOnAbort();
    else signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
}

describe('FaviconFetcher', () => {
  it('returns the well-known favicon without fetching the page', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3]);
    const request = vi.fn(async () => new Response(bytes));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toEqual(bytes);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      'https://example.com/favicon.ico',
      { signal: expect.any(AbortSignal) },
    );
  });

  it('discovers and fetches a relative icon after the well-known path fails', async () => {
    const bytes = Uint8Array.from([4, 5, 6]);
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="icon" href="/assets/site.png">'))
      .mockResolvedValueOnce(response(bytes, { url: 'https://example.com/assets/site.png' }));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toEqual(bytes);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://example.com/assets/site.png',
    ]);
  });

  it('fetches an absolute icon href independent of link attribute order and case', async () => {
    const bytes = Uint8Array.from([7, 8, 9]);
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response(
        '<LINK href="https://cdn.example.net/site.ico" REL="ICON">',
      ))
      .mockResolvedValueOnce(response(bytes, { url: 'https://cdn.example.net/site.ico' }));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toEqual(bytes);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://cdn.example.net/site.ico',
    ]);
  });

  it('recognizes the shortcut icon rel variant', async () => {
    const bytes = Uint8Array.from([10]);
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="shortcut icon" href="shortcut.ico">'))
      .mockResolvedValueOnce(response(bytes));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toEqual(bytes);
    expect(request.mock.calls[2]?.[0]).toBe('https://example.com/shortcut.ico');
  });

  it('recognizes the apple-touch-icon rel variant', async () => {
    const bytes = Uint8Array.from([11]);
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel=apple-touch-icon href=/touch.png>'))
      .mockResolvedValueOnce(response(bytes));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toEqual(bytes);
    expect(request.mock.calls[2]?.[0]).toBe('https://example.com/touch.png');
  });

  it('falls back to the page when the well-known request rejects', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response('<title>No icon</title>'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
    ]);
  });

  it('returns nothing after two requests when the page has no icon link', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="stylesheet" href="styles.css">'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('falls back when reading the well-known favicon body fails', async () => {
    const brokenFavicon = {
      ...response(''),
      arrayBuffer: async () => { throw new TypeError('socket closed'); },
    };
    const request = vi.fn()
      .mockResolvedValueOnce(brokenFavicon)
      .mockResolvedValueOnce(response('<title>No icon</title>'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns nothing when reading the root page body fails', async () => {
    const brokenPage = {
      ...response(''),
      text: async () => { throw new TypeError('socket closed'); },
    };
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(brokenPage);
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns nothing when the root page request rejects', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockRejectedValueOnce(new TypeError('connection refused'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns nothing when the discovered icon request rejects', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="icon" href="site.png">'))
      .mockRejectedValueOnce(new TypeError('connection refused'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('returns nothing when requests reach the configured timeout', async () => {
    const request = vi.fn(rejectWhenAborted);
    const fetcher = new FaviconFetcher({ request, timeoutMs: 1 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('bounds the discovered icon request with the configured timeout', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="icon" href="site.png">'))
      .mockImplementationOnce(rejectWhenAborted);
    const fetcher = new FaviconFetcher({ request, timeoutMs: 1 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not fetch an icon link with an empty href', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="icon" href="">'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns nothing for a malformed icon href', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response('', { ok: false }))
      .mockResolvedValueOnce(response('<link rel="icon" href="https://[">'));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('falls back when the well-known response has no bytes', async () => {
    const bytes = Uint8Array.from([12, 13]);
    const request = vi.fn()
      .mockResolvedValueOnce(response(new Uint8Array()))
      .mockResolvedValueOnce(response('<link rel="icon" href="site.png">'))
      .mockResolvedValueOnce(response(bytes));
    const fetcher = new FaviconFetcher({ request, timeoutMs: 100 });

    await expect(fetcher.fetch('example.com')).resolves.toEqual(bytes);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
