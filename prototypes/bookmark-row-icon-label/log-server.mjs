// E2 — request frequency probe.
//
// Run: node prototypes/bookmark-row-icon-label/log-server.mjs
// Point the `http://localhost:5173/` prototype bookmark's favicon at this
// server (edit PROTOTYPE_BOOKMARKS / faviconUrl() in repositoryTree.ts, or
// just leave port 5173 as-is), then F5 the Extension Development Host,
// focus the window, and leave it for 2 minutes. Every hit to /favicon.ico
// is logged with a timestamp and delta from the previous hit.
//
// Re-run with CACHE=no-store to answer whether an image cache is what's
// saving us: `CACHE=no-store node prototypes/bookmark-row-icon-label/log-server.mjs`

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 5173;
const noStore = process.env.CACHE === 'no-store';

// 1x1 transparent .ico-ish payload is unnecessary — any bytes with the right
// content-type render as a broken/blank icon, which is still informative for E1/E3.
const body = Buffer.from(
  'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAA=',
  'base64',
);

let hitCount = 0;
let lastHitAt = 0;

const server = createServer((req, res) => {
  const now = Date.now();
  hitCount += 1;
  const delta = lastHitAt === 0 ? 0 : now - lastHitAt;
  lastHitAt = now;
  console.log(
    `[${new Date(now).toISOString()}] hit #${hitCount} ${req.method} ${req.url} (+${delta}ms since last)`,
  );

  res.writeHead(200, {
    'content-type': 'image/x-icon',
    ...(noStore ? { 'cache-control': 'no-store' } : {}),
  });
  res.end(body);
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/favicon.ico (CACHE=${noStore ? 'no-store' : 'default'})`);
  console.log('Leave the Extension Development Host focused for 2 minutes, then Ctrl+C and read the hit count above.');
});
