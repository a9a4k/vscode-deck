import { describe, expect, it } from 'vitest';
import { ReleaseNoticeGate } from '../src/releaseNoticeGate';

describe('ReleaseNoticeGate', () => {
  it('stays quiet on first install', () => {
    expect(ReleaseNoticeGate.shouldShow({
      previousVersion: undefined,
      currentVersion: '0.23.0',
      enabled: true,
    })).toBe(false);
  });

  it('shows after an update', () => {
    expect(ReleaseNoticeGate.shouldShow({
      previousVersion: '0.22.0',
      currentVersion: '0.23.0',
      enabled: true,
    })).toBe(true);
  });

  it('stays quiet when the version is unchanged', () => {
    expect(ReleaseNoticeGate.shouldShow({
      previousVersion: '0.23.0',
      currentVersion: '0.23.0',
      enabled: true,
    })).toBe(false);
  });

  it('stays quiet when release notices are disabled', () => {
    expect(ReleaseNoticeGate.shouldShow({
      previousVersion: '0.22.0',
      currentVersion: '0.23.0',
      enabled: false,
    })).toBe(false);
  });
});
