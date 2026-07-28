import * as vscode from 'vscode';
import type { Disposable } from './externalGitWatch';

const DEFAULT_DEBOUNCE_MS = 250;

export function watchGitCommonDir(
  commonDir: string,
  onChange: () => void,
  debounceMs = DEFAULT_DEBOUNCE_MS,
): Disposable {
  let timeout: NodeJS.Timeout | undefined;
  const schedule = (uri: vscode.Uri) => {
    if (isIgnoredGitChange(uri.path)) return;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = undefined;
      onChange();
    }, debounceMs);
  };

  const watchers = [
    createWatcher(commonDir, 'HEAD', schedule),
    createWatcher(commonDir, 'worktrees/**/HEAD', schedule),
    // Git deletes `worktrees` with the last linked worktree, and reports child
    // directory changes while others remain. Neither pattern covers both.
    createWatcher(commonDir, 'worktrees', schedule),
    createWatcher(commonDir, 'worktrees/*', schedule),
  ];

  return {
    dispose() {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
      for (const watcher of watchers) {
        watcher.dispose();
      }
    },
  };
}

function createWatcher(commonDir: string, pattern: string, onChange: (uri: vscode.Uri) => void): Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(commonDir), pattern),
  );
  const subscriptions = [
    watcher.onDidCreate(onChange),
    watcher.onDidChange(onChange),
    watcher.onDidDelete(onChange),
  ];
  return {
    dispose() {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      watcher.dispose();
    },
  };
}

function isIgnoredGitChange(uriPath: string): boolean {
  return (
    /\/(?:index\.lock|worktrees\/[^/]+\/index\.lock)$/.test(uriPath)
    || /\/\.watchman-cookie-/.test(uriPath)
  );
}
