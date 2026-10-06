import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Disposable } from './agentStatusStore';

const OPEN_LAUNCHER_SETTINGS = 'Open Launcher Settings';
const LEARN_MORE = 'Learn More';

interface SharedCodexServerMarker {
  serverPid: number;
  sessionId: string;
  cwd: string;
  at: number;
}

export interface SharedCodexServerMarkerSource {
  read(): Promise<unknown>;
  onDidChange(listener: () => void): Disposable;
}

export interface SharedCodexWorktree {
  path: string;
  repo: string;
  branch: string;
}

interface SharedCodexServerNoticeOptions {
  marker: SharedCodexServerMarkerSource;
  worktrees: { list(): readonly SharedCodexWorktree[] };
  notifications: {
    showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  };
  openLauncherSettings(): void | PromiseLike<void>;
  learnMore(): void | PromiseLike<void>;
}

export class SharedCodexServerNotice {
  private readonly seenLocationsByServerPid = new Map<number, Set<string>>();

  constructor(private readonly options: SharedCodexServerNoticeOptions) {}

  start(): Disposable {
    return this.options.marker.onDidChange(() => {
      void this.handleChange();
    });
  }

  private async handleChange(): Promise<void> {
    let marker: SharedCodexServerMarker | undefined;
    try {
      marker = parseMarker(await this.options.marker.read());
    } catch {
      return;
    }
    if (!marker) return;

    const worktree = containingWorktree(marker.cwd, this.options.worktrees.list());
    const locationKey = worktree?.path ?? '';
    const seenLocations = this.seenLocationsByServerPid.get(marker.serverPid) ?? new Set<string>();
    if (seenLocations.has(locationKey)) return;
    seenLocations.add(locationKey);
    this.seenLocationsByServerPid.set(marker.serverPid, seenLocations);

    const prefix = worktree ? `${worktree.repo}/${worktree.branch}: ` : '';
    const choice = await this.options.notifications.showWarningMessage(
      `${prefix}Codex is using its shared background server, so Deck cannot show its status or resume it. Restart Codex with --no-daemon.`,
      OPEN_LAUNCHER_SETTINGS,
      LEARN_MORE,
    );
    if (choice === OPEN_LAUNCHER_SETTINGS) await this.options.openLauncherSettings();
    else if (choice === LEARN_MORE) await this.options.learnMore();
  }
}

function parseMarker(value: unknown): SharedCodexServerMarker | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { serverPid, sessionId, cwd, at } = value as Record<string, unknown>;
  if (
    typeof serverPid !== 'number'
    || !Number.isInteger(serverPid)
    || serverPid <= 0
    || typeof sessionId !== 'string'
    || typeof cwd !== 'string'
    || typeof at !== 'number'
  ) return undefined;
  return { serverPid, sessionId, cwd, at };
}

function containingWorktree(
  cwd: string,
  worktrees: readonly SharedCodexWorktree[],
): SharedCodexWorktree | undefined {
  const absoluteCwd = resolve(cwd);
  return worktrees
    .filter((worktree) => contains(resolve(worktree.path), absoluteCwd))
    .sort((left, right) => resolve(right.path).length - resolve(left.path).length)[0];
}

function contains(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === '' || (
    pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent)
  );
}
