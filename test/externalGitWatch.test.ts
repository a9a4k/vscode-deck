import { describe, expect, it, vi } from 'vitest';
import { ExternalGitWatch, type Disposable } from '../src/repository/externalGitWatch';

describe('ExternalGitWatch', () => {
  it('reconciles watched common dirs and disposes removed watches', () => {
    const disposables = new Map<string, Disposable>();
    const watchCommonDir = vi.fn((commonDir: string) => {
      const disposable = { dispose: vi.fn() };
      disposables.set(commonDir, disposable);
      return disposable;
    });
    const externalGitWatch = new ExternalGitWatch(watchCommonDir, () => undefined, () => 'stable');

    externalGitWatch.sync(new Set(['/git/alpha', '/git/beta']));
    externalGitWatch.sync(new Set(['/git/beta', '/git/gamma']));

    expect(watchCommonDir).toHaveBeenCalledTimes(3);
    expect(watchCommonDir.mock.calls.map(([commonDir]) => commonDir)).toEqual([
      '/git/alpha',
      '/git/beta',
      '/git/gamma',
    ]);
    expect(disposables.get('/git/alpha')?.dispose).toHaveBeenCalledOnce();
    expect(disposables.get('/git/beta')?.dispose).not.toHaveBeenCalled();
    expect(disposables.get('/git/gamma')?.dispose).not.toHaveBeenCalled();

    externalGitWatch.sync(new Set(['/git/beta', '/git/gamma']));

    expect(watchCommonDir).toHaveBeenCalledTimes(3);
    expect(disposables.get('/git/beta')?.dispose).not.toHaveBeenCalled();
    expect(disposables.get('/git/gamma')?.dispose).not.toHaveBeenCalled();

    externalGitWatch.dispose();

    expect(disposables.get('/git/beta')?.dispose).toHaveBeenCalledOnce();
    expect(disposables.get('/git/gamma')?.dispose).toHaveBeenCalledOnce();
  });

  it('does not create watches after disposal', () => {
    const watchCommonDir = vi.fn(() => ({ dispose: vi.fn() }));
    const externalGitWatch = new ExternalGitWatch(watchCommonDir, () => undefined, () => 'stable');

    externalGitWatch.dispose();
    externalGitWatch.sync(new Set(['/git/alpha']));

    expect(watchCommonDir).not.toHaveBeenCalled();
  });

  it('retries a common dir that could not be watched', () => {
    const watch = { dispose: vi.fn() };
    const watchCommonDir = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(watch);
    const externalGitWatch = new ExternalGitWatch(watchCommonDir, () => undefined, () => 'stable');

    externalGitWatch.sync(new Set(['/git/alpha']));
    externalGitWatch.sync(new Set(['/git/alpha']));
    externalGitWatch.sync(new Set(['/git/alpha']));

    expect(watchCommonDir).toHaveBeenCalledTimes(2);
    expect(watch.dispose).not.toHaveBeenCalled();
  });

  it('replaces a watch after its common dir disappears and returns', () => {
    let commonDirIdentity: string | undefined = 'first';
    const watches: Disposable[] = [];
    const watchCommonDir = vi.fn(() => {
      const watch = { dispose: vi.fn() };
      watches.push(watch);
      return watch;
    });
    const externalGitWatch = new ExternalGitWatch(
      watchCommonDir,
      () => undefined,
      () => commonDirIdentity,
    );

    externalGitWatch.sync(new Set(['/git/alpha']));
    commonDirIdentity = undefined;
    externalGitWatch.sync(new Set(['/git/alpha']));

    expect(watches[0]?.dispose).toHaveBeenCalledOnce();
    expect(watchCommonDir).toHaveBeenCalledOnce();

    commonDirIdentity = 'second';
    externalGitWatch.sync(new Set(['/git/alpha']));
    externalGitWatch.sync(new Set(['/git/alpha']));

    expect(watchCommonDir).toHaveBeenCalledTimes(2);
    expect(watches[1]?.dispose).not.toHaveBeenCalled();
  });

  it('replaces a watch when its common dir is recreated before the next sync', () => {
    let commonDirIdentity = 'first';
    const watches: Disposable[] = [];
    const watchCommonDir = vi.fn(() => {
      const watch = { dispose: vi.fn() };
      watches.push(watch);
      return watch;
    });
    const externalGitWatch = new ExternalGitWatch(
      watchCommonDir,
      () => undefined,
      () => commonDirIdentity,
    );

    externalGitWatch.sync(new Set(['/git/alpha']));
    commonDirIdentity = 'second';
    externalGitWatch.sync(new Set(['/git/alpha']));
    externalGitWatch.sync(new Set(['/git/alpha']));

    expect(watches[0]?.dispose).toHaveBeenCalledOnce();
    expect(watchCommonDir).toHaveBeenCalledTimes(2);
    expect(watches[1]?.dispose).not.toHaveBeenCalled();
  });

  it('identifies the changed common dir', () => {
    let change: (() => void) | undefined;
    const onChange = vi.fn();
    const externalGitWatch = new ExternalGitWatch(
      vi.fn((_commonDir, listener) => {
        change = listener;
        return { dispose: vi.fn() };
      }),
      onChange,
      () => 'stable',
    );
    externalGitWatch.sync(new Set(['/git/alpha']));

    change?.();

    expect(onChange).toHaveBeenCalledWith('/git/alpha');
  });
});
