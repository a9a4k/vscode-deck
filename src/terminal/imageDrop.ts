import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

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
const MAX_WRITE_ATTEMPTS = 100;

export interface ImageDropPayload {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ImageDropDependencies {
  now(): number;
  createDirectory(path: string): Promise<void>;
  writeFileExclusively(path: string, bytes: Uint8Array): Promise<void>;
}

export interface MaterializedImageDrop {
  filePath: string;
}

const nodeDependencies: ImageDropDependencies = {
  now: Date.now,
  createDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeFileExclusively: async (path, bytes) => {
    await writeFile(path, bytes, { flag: 'wx' });
  },
};

export async function materializeImageDrop(
  targetDirectory: string,
  payload: ImageDropPayload,
  dependencies: ImageDropDependencies = nodeDependencies,
): Promise<MaterializedImageDrop> {
  await dependencies.createDirectory(targetDirectory);
  const droppedName = basename(payload.name);
  const droppedExtension = extname(droppedName);
  const extension = IMAGE_EXTENSIONS[payload.mime.toLowerCase()] ?? droppedExtension.toLowerCase();
  const stem = basename(droppedName, droppedExtension)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';
  const timestamp = dependencies.now();
  for (let collision = 0; collision < MAX_WRITE_ATTEMPTS; collision += 1) {
    const suffix = collision === 0 ? '' : `-${collision}`;
    const filePath = join(targetDirectory, `${timestamp}-${stem}${suffix}${extension}`);
    try {
      await dependencies.writeFileExclusively(filePath, payload.bytes);
      return { filePath };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Could not materialize dropped image after ${MAX_WRITE_ATTEMPTS} filename collisions.`);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
