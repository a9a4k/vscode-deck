export class ReleaseNoticeGate {
  static shouldShow(input: {
    previousVersion: string | undefined;
    currentVersion: string;
    enabled: boolean;
  }): boolean {
    return input.enabled
      && input.previousVersion !== undefined
      && input.previousVersion !== input.currentVersion;
  }
}
