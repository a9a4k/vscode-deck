export interface Disposable {
  dispose(): unknown;
}

export type WatchCommonDir = (commonDir: string, onChange: () => void) => Disposable;

export class ExternalGitWatch implements Disposable {
  private readonly watches = new Map<string, Disposable>();
  private disposed = false;

  constructor(
    private readonly watchCommonDir: WatchCommonDir,
    private readonly onChange: (commonDir: string) => void = () => undefined,
  ) {}

  sync(commonDirs: ReadonlySet<string>): void {
    if (this.disposed) return;

    for (const [commonDir, watch] of this.watches) {
      if (commonDirs.has(commonDir)) continue;
      watch.dispose();
      this.watches.delete(commonDir);
    }

    for (const commonDir of commonDirs) {
      if (this.watches.has(commonDir)) continue;
      this.watches.set(
        commonDir,
        this.watchCommonDir(commonDir, () => this.onChange(commonDir)),
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const watch of this.watches.values()) {
      watch.dispose();
    }
    this.watches.clear();
  }
}
