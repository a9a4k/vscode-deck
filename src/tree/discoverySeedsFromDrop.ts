import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';

export type DirectoryCheck = (path: string) => Promise<boolean>;

const statDirectory: DirectoryCheck = async (path) => (await stat(path)).isDirectory();

export async function discoverySeedsFromDrop(
  uriList: string,
  isDirectory: DirectoryCheck = statDirectory,
): Promise<string[]> {
  const paths = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((uri) => vscode.Uri.parse(uri).fsPath)
    .filter((path) => path.length > 0);

  const confirmedNonDirectories = await Promise.all(paths.map(async (path) => {
    try {
      return !(await isDirectory(path));
    } catch {
      return false;
    }
  }));
  return paths.filter((_, index) => !confirmedNonDirectories[index]);
}
