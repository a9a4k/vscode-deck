import { readFile } from 'node:fs/promises';

const packagedFiles = new Set(
  (await readStdin()).split(/\r?\n/).filter(Boolean),
);
const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const lockfilePackageEntries = Object.entries(packageLock.packages)
  .filter(([path]) => path.startsWith('node_modules/'));
const productionPackagePaths = lockfilePackageEntries
  .filter(([, metadata]) => metadata.dev !== true)
  .map(([path]) => path);
const devOnlyPackagePaths = lockfilePackageEntries
  .filter(([, metadata]) => metadata.dev === true)
  .map(([path]) => path);

const requiredFiles = [
  'dist/extension.js',
  ...productionPackagePaths.map((path) => `${path}/package.json`),
];
const missingFiles = requiredFiles
  .filter((path) => !packagedFiles.has(path));
const leakedDevOnlyFiles = [...packagedFiles]
  .filter((file) => devOnlyPackagePaths.some((path) => file.startsWith(`${path}/`)));

if (missingFiles.length > 0 || leakedDevOnlyFiles.length > 0) {
  if (missingFiles.length > 0) {
    console.error(`Missing runtime files:\n${missingFiles.join('\n')}`);
  }
  if (leakedDevOnlyFiles.length > 0) {
    console.error(`Dev-only dependency files included:\n${leakedDevOnlyFiles.join('\n')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`VSIX contains ${productionPackagePaths.length} production packages and no dev-only packages.`);
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
