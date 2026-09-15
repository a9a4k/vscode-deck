import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Webview assets must ship inside the .vsix. VSCE excludes their dev-only xterm
// packages, and exposing node_modules via localResourceRoots is discouraged, so
// copy the bundles loaded by the terminal webview into dist/media. Keep this list
// in sync with the asWebviewUri calls in terminalEditorProvider.ts.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'dist', 'media');

const assets = [
  '@xterm/xterm/lib/xterm.js',
  '@xterm/xterm/css/xterm.css',
  '@xterm/addon-fit/lib/addon-fit.js',
  '@xterm/addon-web-links/lib/addon-web-links.js',
  '@xterm/addon-search/lib/addon-search.js',
  '@xterm/addon-unicode11/lib/addon-unicode11.js',
];

mkdirSync(dest, { recursive: true });
for (const asset of assets) {
  const from = join(root, 'node_modules', asset);
  const to = join(dest, asset.split('/').pop());
  cpSync(from, to);
}
