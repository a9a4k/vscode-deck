import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';

type DirectoryCheck = (path: string) => Promise<boolean>;

const isDirectoryOnDisk: DirectoryCheck = async (path) => (await stat(path)).isDirectory();

export async function discoverySeedsFromDrop(
  uriList: string,
  isDirectory: DirectoryCheck = isDirectoryOnDisk,
): Promise<string[]> {
  const paths = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((uri) => vscode.Uri.parse(uri).fsPath)
    .filter((path) => path.length > 0);

  const seeds = await Promise.all(paths.map(async (path) => {
    try {
      return await isDirectory(path) ? path : undefined;
    } catch {
      return path;
    }
  }));
  return seeds.filter((path): path is string => path !== undefined);
}
