export const RELEASE_NOTICE_LAST_SEEN_VERSION_KEY = 'deck.releaseNotice.lastSeenVersion';

interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export class ReleaseNoticeStore {
  constructor(private readonly memento: MementoLike) {}

  get(): string | undefined {
    return this.memento.get<string>(RELEASE_NOTICE_LAST_SEEN_VERSION_KEY);
  }

  async set(version: string): Promise<void> {
    await this.memento.update(RELEASE_NOTICE_LAST_SEEN_VERSION_KEY, version);
  }
}
