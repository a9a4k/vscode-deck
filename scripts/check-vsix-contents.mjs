import { readFile } from 'node:fs/promises';

const packagedFiles = new Set(
  (await readStdin()).split(/\r?\n/).filter(Boolean),
);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const packageEntries = Object.entries(lock.packages)
  .filter(([path]) => path.startsWith('node_modules/'));
const productionPackages = packageEntries
  .filter(([, metadata]) => metadata.dev !== true)
  .map(([path]) => path);
const devOnlyPackages = packageEntries
  .filter(([, metadata]) => metadata.dev === true)
  .map(([path]) => path);

const requiredFiles = [
  'dist/extension.js',
  ...productionPackages.map((path) => `${path}/package.json`),
];
const missing = requiredFiles
  .filter((path) => !packagedFiles.has(path));
const leaked = [...packagedFiles]
  .filter((file) => devOnlyPackages.some((path) => file.startsWith(`${path}/`)));

if (missing.length > 0 || leaked.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing runtime files:\n${missing.join('\n')}`);
  }
  if (leaked.length > 0) {
    console.error(`Dev-only dependency files included:\n${leaked.join('\n')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`VSIX contains ${productionPackages.length} production packages and no dev-only packages.`);
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
