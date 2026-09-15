export type FaviconRequest = (
  url: string,
  options: { signal: AbortSignal },
) => Promise<Pick<Response, 'ok' | 'url' | 'arrayBuffer' | 'text'>>;

export interface FaviconFetcherOptions {
  request?: FaviconRequest;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;

export class FaviconFetcher {
  private readonly request: FaviconRequest;
  private readonly timeoutMs: number;

  constructor(options: FaviconFetcherOptions = {}) {
    this.request = options.request ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetch(hostname: string): Promise<Uint8Array | undefined> {
    const faviconUrl = `https://${hostname}/favicon.ico`;
    const favicon = await this.getBytes(faviconUrl);
    if (favicon !== undefined) return favicon;

    const pageUrl = `https://${hostname}/`;
    const page = await this.getPage(pageUrl);
    if (page === undefined) return undefined;

    const href = discoverIconHref(page.html);
    if (href === undefined) return undefined;

    const iconUrl = resolveIconUrl(href, page.url || pageUrl);
    if (iconUrl === undefined) return undefined;
    return this.getBytes(iconUrl);
  }

  private async get(url: string): Promise<Awaited<ReturnType<FaviconRequest>> | undefined> {
    try {
      return await this.request(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      return undefined;
    }
  }

  private async getBytes(url: string): Promise<Uint8Array | undefined> {
    const response = await this.get(url);
    if (!response?.ok) return undefined;
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength === 0 ? undefined : bytes;
    } catch {
      return undefined;
    }
  }

  private async getPage(url: string): Promise<{ html: string; url: string } | undefined> {
    const response = await this.get(url);
    if (!response?.ok) return undefined;
    try {
      return { html: await response.text(), url: response.url };
    } catch {
      return undefined;
    }
  }
}

function resolveIconUrl(href: string, pageUrl: string): string | undefined {
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return undefined;
  }
}

function discoverIconHref(html: string): string | undefined {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[0].matchAll(
      /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
    )) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]);
    }

    const rel = attributes.get('rel')?.toLowerCase().split(/\s+/);
    if (rel?.some((value) => value === 'icon' || value === 'apple-touch-icon')) {
      const href = attributes.get('href')?.trim();
      if (href) return href;
    }
  }
  return undefined;
}
