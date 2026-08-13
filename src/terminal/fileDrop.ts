import * as vscode from 'vscode';

/**
 * One bracketed paste carrying every dropped path, space separated. Measured
 * against a live agent: one paste per path loses the first path's text when the
 * pastes reach the pane together, and unseparated paths merge into one unusable
 * token.
 */
export function fileDropPasteInput(filePaths: readonly string[]): string {
  if (filePaths.length === 0) return '';
  return `\x1b[200~${filePaths.join(' ')}\x1b[201~`;
}

export function filePathsFromUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(filePath)
    .filter((path): path is string => path !== undefined);
}

/**
 * `Uri.parse` throws on anything that is not a URI, and a drag source can put
 * arbitrary text on a uri-list key. Reading the wrong key once made every
 * Explorer drop reject the host's message handler instead of pasting (#179).
 */
function filePath(line: string): string | undefined {
  try {
    const uri = vscode.Uri.parse(line);
    return uri.scheme === 'file' ? uri.fsPath : undefined;
  } catch {
    return undefined;
  }
}
