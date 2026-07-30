export interface Disposable {
  dispose(): unknown;
}

export type WatchCommonDir = (commonDir: string, onChange: () => void) => Disposable | undefined;
export type ReadCommonDirIdentity = (commonDir: string) => string | undefined;

interface CommonDirWatch {
  identity: string;
  disposable: Disposable;
}

export class ExternalGitWatch implements Disposable {
  private readonly watches = new Map<string, CommonDirWatch>();
  private disposed = false;

  constructor(
    private readonly watchCommonDir: WatchCommonDir,
    private readonly onChange: (commonDir: string) => void,
    private readonly readCommonDirIdentity: ReadCommonDirIdentity,
  ) {}

  sync(commonDirs: ReadonlySet<string>): void {
    if (this.disposed) return;

    for (const [commonDir, watch] of this.watches) {
      if (commonDirs.has(commonDir)) continue;
      watch.disposable.dispose();
      this.watches.delete(commonDir);
    }

    for (const commonDir of commonDirs) {
      const identity = this.readCommonDirIdentity(commonDir);
      const existing = this.watches.get(commonDir);
      if (identity !== undefined && existing?.identity === identity) continue;

      existing?.disposable.dispose();
      this.watches.delete(commonDir);
      if (identity === undefined) continue;

      const disposable = this.watchCommonDir(commonDir, () => this.onChange(commonDir));
      if (disposable !== undefined) this.watches.set(commonDir, { identity, disposable });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const watch of this.watches.values()) {
      watch.disposable.dispose();
    }
    this.watches.clear();
  }
}
