import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/apng': '.apng',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/tiff': '.tif',
  'image/vnd.microsoft.icon': '.ico',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
};

export interface ImageDropPayload {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ImageDropDependencies {
  now(): number;
  writeFileExclusively(path: string, bytes: Uint8Array): Promise<void>;
}

export interface MaterializedImageDrop {
  filePath: string;
  terminalInput: string;
}

const nodeDependencies: ImageDropDependencies = {
  now: Date.now,
  writeFileExclusively: async (path, bytes) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  },
};

export async function materializeImageDrop(
  targetDirectory: string,
  payload: ImageDropPayload,
  dependencies: ImageDropDependencies = nodeDependencies,
): Promise<MaterializedImageDrop> {
  const droppedName = basename(payload.name);
  const droppedExtension = extname(droppedName);
  const extension = IMAGE_EXTENSIONS[payload.mime.toLowerCase()] ?? droppedExtension.toLowerCase();
  const stem = basename(droppedName, droppedExtension)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';
  const timestamp = dependencies.now();
  let collision = 0;
  while (true) {
    const suffix = collision === 0 ? '' : `-${collision}`;
    const filePath = join(targetDirectory, `${timestamp}-${stem}${suffix}${extension}`);
    try {
      await dependencies.writeFileExclusively(filePath, payload.bytes);
      return {
        filePath,
        terminalInput: `\x1b[200~${filePath}\x1b[201~`,
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      collision += 1;
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
